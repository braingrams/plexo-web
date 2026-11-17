import { randomUUID } from "node:crypto";
import type { EntityItem } from "electrodb";

import { SOL_SYSTEM_PROMPT } from "@charisol/plexo-sdk/v2/compile";
import { dispatchMcpTool, type ResolvedUser } from "@/lib/mcp/dispatchMcpTool";
import { isDestructiveTool } from "@/lib/mcp/toolRiskClassification";
import { generateWithTools as bedrockGenerateWithTools } from "@/lib/ai/providers/bedrockClaude";
import { generateWithTools as anthropicGenerateWithTools } from "@/lib/ai/providers/anthropic";
import { generateWithTools as openaiGenerateWithTools } from "@/lib/ai/providers/openai";
import { generateWithTools as geminiGenerateWithTools } from "@/lib/ai/providers/gemini";
import type { GenerateWithToolsParams, GenerateWithToolsResult } from "@/lib/ai/providers/shared";
import { getAllSolTools, ASK_USER_QUESTION_TOOL_NAME, USE_ATTACHED_IMAGE_TOOL_NAME, type BedrockToolDef } from "@/lib/ai/solToolSchema";
import { resolveModel } from "@/lib/ai/modelRegistry";
import { MAX_TOKENS } from "@/lib/ai/generate";
import { MAX_TOOL_ITERATIONS, MAX_APP_TOOL_ITERATIONS, MAX_SITE_TOOL_ITERATIONS, SITE_BUILD_TOOLS } from "@/lib/credits/agentTurnEstimate";
import type { TurnProgress, TokenUsage } from "@/lib/credits/turnBudget";
import type { AiProvider, ConcreteTier } from "@/lib/ai/types";
import { SolMessage } from "@/lib/db/solEntities";
import { trimOldToolWork } from "@/lib/ai/solHistoryTrim";
import { solBuildProfilePrompt, type SolBuildProfile } from "@/lib/ai/solBuildContext";
import { QUALITY_BAR, SAVE_BRAND_GUIDE, briefFromConversation, discoveryPrompt } from "@/lib/ai/solDiscovery";
import { createAttachmentResolver, publishAttachedImage, PRIVATE_ATTACHMENT_PATH } from "@/lib/ai/solAttachments";

/** A tool call SOL runs itself (see solToolSchema.ts) or a Plexo MCP tool. */
// Per-turn limits on the costly app tools: each screenshot and build adds to what every later
// step re-reads, and a fix loop can otherwise repeat them dozens of times.
const MAX_SCREENSHOTS_PER_TURN = 8;
const MAX_BUILDS_PER_TURN = 12;

interface TurnGuard {
  /** The app this chat belongs to, when it is an app's builder chat. */
  boundAppId?: string;
  counts: Map<string, number>;
}

/** Refuses a call that would work on the wrong app or burn credits in a loop. The message goes
 *  back to SOL as the tool's error, so it corrects itself. */
function guardTool(name: string, input: any, guard: TurnGuard): void {
  if (guard.boundAppId) {
    if (name === "create_app") {
      throw new Error(`This chat belongs to the app ${guard.boundAppId}. Build inside it with the app_* tools and appId ${guard.boundAppId} — don't create another app.`);
    }
    if (name.startsWith("app_") && typeof input?.appId === "string" && input.appId !== guard.boundAppId) {
      throw new Error(`This chat belongs to the app ${guard.boundAppId}, not ${input.appId}. Use appId ${guard.boundAppId}.`);
    }
  }
  const limit = name === "app_screenshot" ? MAX_SCREENSHOTS_PER_TURN : name === "app_build" ? MAX_BUILDS_PER_TURN : 0;
  if (!limit) return;
  const used = (guard.counts.get(name) ?? 0) + 1;
  guard.counts.set(name, used);
  if (used > limit) {
    throw new Error(`That's ${limit} ${name === "app_screenshot" ? "screenshots" : "builds"} in this turn — enough. Stop checking, and tell the owner what you did, what looks right, and anything still open. They can say "continue" to carry on.`);
  }
}

async function runSolTool(name: string, input: any, user: ResolvedUser, history: HistoryEntry[], guard: TurnGuard): Promise<unknown> {
  guardTool(name, input, guard);
  if (name === USE_ATTACHED_IMAGE_TOOL_NAME) return publishAttachedImage(user.userId, input?.attachment, history);
  // A chat attachment's address is private: in a page, it's a broken image for every
  // visitor (what happened before use_attached_image worked — SOL then said it was done).
  if (JSON.stringify(input ?? null).includes(PRIVATE_ATTACHMENT_PATH)) {
    throw new Error("This puts a private chat-attachment address in the page, which visitors can't load. Call use_attached_image with that image's reference first, and use the address it returns.");
  }
  return dispatchMcpTool(name, input, user);
}

// Which provider actually serves a turn's model calls — resolved once per turn by the
// caller (solChatHandler.ts) from the account's AI Access Mode: BYOK accounts route to
// their own configured provider/key (billed to that provider directly, no Plexo credits
// touched); everyone else routes to Plexo's system Bedrock Claude, credit-metered as
// before. Every provider's `generateWithTools` shares the same Anthropic-shaped in/out
// contract (see providers/shared.ts), so this dispatch table is the only place that needs
// to know there's more than one.
export const TOOL_CAPABLE_PROVIDERS: Record<AiProvider, (params: GenerateWithToolsParams) => Promise<GenerateWithToolsResult>> = {
  bedrock_claude: bedrockGenerateWithTools,
  anthropic_claude: anthropicGenerateWithTools,
  openai: openaiGenerateWithTools,
  google_gemini: geminiGenerateWithTools,
};

// SOL's agent orchestration loop: the one place that actually drives a multi-turn,
// tool-using conversation with the model, persists the transcript, and enforces the
// human-in-the-loop confirmation gate for destructive tool calls (see
// lib/mcp/toolRiskClassification.ts). Two entry points:
//   - runAgentTurn: starts from a fresh user message.
//   - resumeAgentTurn: continues a turn that paused on a destructive tool call, once the
//     user has confirmed or declined it.
// Both delegate their actual model-call/tool-dispatch loop to the shared `continueLoop`
// helper below so the two code paths can't drift apart.

export type SolMessageItem = EntityItem<typeof SolMessage>;

/** A single Anthropic/Bedrock-shaped conversation turn, as `generateWithTools` expects. */
type HistoryEntry = { role: "user" | "assistant"; content: any };

// How many of a conversation's most recent messages to feed back to the model as context.
// Bounded rather than "the whole conversation" for two reasons: token cost (every message
// is replayed on every single model call within a turn, not just once) and DynamoDB query
// cost. 40 messages is generous for a chat-style interaction — tens of user/assistant
// exchanges, plus their interleaved tool-call/tool-result pairs.
const MAX_HISTORY_MESSAGES = 40;

export class InsufficientCreditsError extends Error {
  constructor(message = "Insufficient credits to continue this action.") {
    super(message);
    this.name = "InsufficientCreditsError";
  }
}

export class AgentIterationLimitError extends Error {
  constructor(message = "SOL paused after a lot of steps. Everything so far is saved — say “continue” and it'll pick up where it left off.") {
    super(message);
    this.name = "AgentIterationLimitError";
  }
}

export interface AgentTurnDeps {
  conversationId: string;
  resolvedUser: ResolvedUser;
  modelTier: ConcreteTier;
  /** Which provider actually serves this turn's model calls — resolved by the caller from
   * the account's AI Access Mode (see solChatHandler.ts). */
  provider: AiProvider;
  /** BYOK accounts' own decrypted provider key; absent/ignored for `bedrock_claude`. */
  apiKey?: string;
  /** Bedrock/Anthropic content blocks (text, image, document refs) for the new user message. */
  userMessageContent: any[];
  memoryFacts: string[];
  /** When the conversation is an app's builder chat: what SOL needs to know about that app. */
  appContext?: string;
  /** The owner's SOL settings (tone, length, custom instructions) — see solPreferencesPrompt. */
  preferences?: SolPromptPreferences;
  /** What the owner is building, from onboarding (lib/ai/solBuildContext.ts). */
  buildProfile?: SolBuildProfile;
  /** The app this conversation is bound to (an app builder chat) — SOL may only work on that one. */
  boundAppId?: string;
  onTextDelta: (delta: string) => void;
  onToolCallStart: (call: { id: string; name: string; args: any }) => void;
  /** While the model is still writing a tool call's input (see GenerateWithToolsParams). */
  onToolCallPreparing?: (progress: { id: string; name: string; characters: number }) => void;
  /** `messageId` is the PENDING SolMessage row's own id — the client needs it (not just the
   * Anthropic tool_use id) to actually resume the turn (see the confirm/answer routes),
   * and sending it in this same callback/frame is what lets the client act on a pause the
   * instant it arrives, with no separate follow-up fetch (and the race that came with
   * one — see SolChatView's own comment on why that follow-up fetch was removed). */
  onToolCallAwaitingConfirmation: (call: { id: string; name: string; args: any; messageId: string }) => Promise<void>;
  onToolCallResult: (result: { id: string; name: string; status: "success" | "error" | "cancelled"; result?: any }) => void;
  /** Re-checks credit balance before each model call; false stops the loop. */
  /** The new user message's key once it's saved (e.g. to add its images' descriptions). */
  onUserMessageSaved?: (key: { id: string; createdAt: string }) => void;
  budgetGuard: (progress: TurnProgress) => Promise<boolean>;
  /** Longest answer per round (output tokens) — shorter for Free accounts on Plexo's AI
   *  (lib/ai/solEngine.ts maxAnswerTokensFor). Defaults to MAX_TOKENS.agent_chat. */
  maxOutputTokens?: number;
}

export interface RunAgentTurnResult {
  finalText: string;
  usage: { inputTokens: number; outputTokens: number };
  pendingConfirmation?: { messageId: string; toolCallId: string; name: string; args: any };
}

/** One question's resolved answer, as the client submits it — `answer` is either the
 * option label(s) the user picked (joined with "; " for a multiSelect question) or their
 * own free-typed text, already flattened to a single string. The model never sees the
 * distinction between "picked an option" and "typed something" — both read the same way,
 * exactly like the destructive-confirmation gate doesn't care whether "confirmed" came
 * from a click or (hypothetically) any other input method. */
export interface AskUserAnswer {
  question: string;
  answer: string;
}

export interface ResumeAgentTurnDeps {
  conversationId: string;
  resolvedUser: ResolvedUser;
  modelTier: ConcreteTier;
  /** Same meaning as AgentTurnDeps — re-resolved by the caller for each resume, since a
   * BYOK account's key/provider could in principle have changed between the original pause
   * and the resume. */
  provider: AiProvider;
  apiKey?: string;
  /** The tool_use id (from the earlier pendingConfirmation) the user is responding to. */
  toolCallId: string;
  /** Required unless the pending tool call is ask_user_question, in which case `answers`
   * is required instead — see the loop below. */
  decision?: "confirmed" | "declined";
  /** Required only when resuming an ask_user_question pause. */
  answers?: AskUserAnswer[];
  memoryFacts: string[];
  appContext?: string;
  preferences?: SolPromptPreferences;
  buildProfile?: SolBuildProfile;
  boundAppId?: string;
  onTextDelta: (delta: string) => void;
  onToolCallStart: (call: { id: string; name: string; args: any }) => void;
  /** While the model is still writing a tool call's input (see GenerateWithToolsParams). */
  onToolCallPreparing?: (progress: { id: string; name: string; characters: number }) => void;
  onToolCallAwaitingConfirmation: (call: { id: string; name: string; args: any; messageId: string }) => Promise<void>;
  onToolCallResult: (result: { id: string; name: string; status: "success" | "error" | "cancelled"; result?: any }) => void;
  budgetGuard: (progress: TurnProgress) => Promise<boolean>;
  /** Longest answer per round (output tokens) — shorter for Free accounts on Plexo's AI
   *  (lib/ai/solEngine.ts maxAnswerTokensFor). Defaults to MAX_TOKENS.agent_chat. */
  maxOutputTokens?: number;
}

/** Loads a conversation's most recent messages, oldest first (chronological). */
async function loadRecentMessages(conversationId: string): Promise<SolMessageItem[]> {
  const { data } = await SolMessage.query.primary({ conversationId }).go({ order: "desc", limit: MAX_HISTORY_MESSAGES });
  return [...data].reverse();
}

/** A stored "tool" role (our own bookkeeping distinction for a tool_results message) is
 * always sent back to the model as "user" — Anthropic has no third role; a tool_result
 * content block is only ever valid inside a user-role message. */
function toHistoryEntry(message: SolMessageItem): HistoryEntry {
  return { role: message.role === "assistant" ? "assistant" : "user", content: message.content };
}

function extractText(content: any[]): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
}

function buildToolResultBlock(toolUseId: string, output: unknown, isError: boolean) {
  // A tool can return rich content (app_screenshot: text + an image the model should see)
  // as __contentBlocks; its image is stored privately and resolved to bytes just before the
  // model call (lib/ai/solAttachments.ts), so the saved conversation stays small.
  const blocks = output && typeof output === "object" && Array.isArray((output as any).__contentBlocks) ? (output as any).__contentBlocks : null;
  return {
    type: "tool_result",
    tool_use_id: toolUseId,
    content: blocks ?? (typeof output === "string" ? output : JSON.stringify(output ?? null)),
    is_error: isError,
  };
}

const ANSWERED_IN_CHAT = "The user didn't use the buttons — they answered in their own words in the message that follows.";
const SUPERSEDED_BY_MESSAGE = "Not done: the user sent a new message instead of confirming this. Don't do it unless they ask for it again.";

/**
 * Makes a history the Messages API will accept: every tool_use answered by a tool_result in
 * the very next message, and no tool_result without its tool_use. Two real ways it breaks:
 * the person replies in their own words while SOL's question (or a confirmation) is still
 * open — the open tool_use then has no result, and every later turn of that chat failed with
 * a 400 — and the 40-message window starting just after a tool_use, leaving its results
 * orphaned. An unanswered question takes the reply that follows as its answer; an
 * unconfirmed action counts as not done.
 */
export function pairToolCalls(history: HistoryEntry[]): HistoryEntry[] {
  const toolUses = (entry: HistoryEntry | undefined): any[] =>
    entry?.role === "assistant" && Array.isArray(entry.content) ? entry.content.filter((b: any) => b?.type === "tool_use") : [];
  const asBlocks = (content: unknown): any[] => (Array.isArray(content) ? content : [{ type: "text", text: String(content ?? "") }]);

  const entries = [...history];
  const out: HistoryEntry[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.role === "user") {
      const prev = out[out.length - 1];
      const answerable = new Set(toolUses(prev).map((b) => b.id));
      const content = asBlocks(entry.content).filter((b: any) => b?.type !== "tool_result" || answerable.has(b.tool_use_id));
      if (content.length > 0) out.push({ ...entry, content });
      continue;
    }
    if (out.length === 0) continue; // the conversation sent to the model must start with the user
    out.push(entry);
    const uses = toolUses(entry);
    const next = entries[i + 1];
    if (uses.length === 0 || !next) continue; // nothing to answer, or the pause still open right now
    const answered = new Set(next.role === "user" ? asBlocks(next.content).filter((b: any) => b?.type === "tool_result").map((b: any) => b.tool_use_id) : []);
    const missing = uses
      .filter((b) => !answered.has(b.id))
      .map((b) => (b.name === ASK_USER_QUESTION_TOOL_NAME ? buildToolResultBlock(b.id, ANSWERED_IN_CHAT, false) : buildToolResultBlock(b.id, SUPERSEDED_BY_MESSAGE, true)));
    if (missing.length === 0) continue;
    if (next.role === "user") entries[i + 1] = { ...next, content: [...missing, ...asBlocks(next.content)] };
    else entries.splice(i + 1, 0, { role: "user", content: missing });
  }
  return out;
}

/** Renders the user's answers back as plain text for the model — the same "replay
 * verbatim, keep it human-readable" spirit as every other tool_result in this file. */
function formatAnswersForModel(answers: AskUserAnswer[]): string {
  if (answers.length === 0) return "The user didn't provide any answers.";
  return answers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join("\n\n");
}

/** The owner's own SOL settings (Settings → SOL): how SOL should sound and how long it should be. */
export interface SolPromptPreferences {
  tonePreset?: "PROFESSIONAL" | "FRIENDLY" | "CONCISE" | "DETAILED" | null;
  responseLength?: "CONCISE" | "BALANCED" | "THOROUGH" | null;
  customInstructions?: string | null;
}

export interface SolPromptOptions {
  preferences?: SolPromptPreferences;
  /** What the owner is building, from onboarding (lib/ai/solBuildContext.ts). */
  profile?: SolBuildProfile;
  /** This request's intake and creative direction (lib/ai/solDiscovery.ts discoveryPrompt); "" for changes to existing work. */
  discovery?: string;
}

const TONE_GUIDE: Record<NonNullable<SolPromptPreferences["tonePreset"]>, string> = {
  PROFESSIONAL: "Write in a polished, professional voice — courteous and precise, no slang or jokes.",
  FRIENDLY: "Write in a warm, friendly voice — encouraging and human, like a helpful teammate.",
  CONCISE: "Write tersely — short sentences, no pleasantries, only what matters.",
  DETAILED: "Write in a detailed voice — explain your reasoning and choices so the owner learns along the way.",
};

const LENGTH_GUIDE: Record<NonNullable<SolPromptPreferences["responseLength"]>, string> = {
  CONCISE: "Keep replies short: a few sentences, or a tight list. Plans fit in five lines.",
  BALANCED: "Keep replies a comfortable length: complete, but no padding.",
  THOROUGH: "Be thorough: fuller plans, clear explanations of what you built and why, and good next steps.",
};

/** The owner's SOL settings as a prompt block ("" when they haven't set anything). Exported for tests. */
export function solPreferencesPrompt(prefs?: SolPromptPreferences): string {
  if (!prefs) return "";
  const lines: string[] = [];
  if (prefs.tonePreset && TONE_GUIDE[prefs.tonePreset]) lines.push(TONE_GUIDE[prefs.tonePreset]);
  if (prefs.responseLength && prefs.responseLength !== "BALANCED" && LENGTH_GUIDE[prefs.responseLength]) lines.push(LENGTH_GUIDE[prefs.responseLength]);
  const custom = typeof prefs.customInstructions === "string" ? prefs.customInstructions.trim().slice(0, 2000) : "";
  if (custom) {
    lines.push(
      `The owner's own instructions for you (follow them unless they'd mean deleting things without confirmation, spending their money, or breaking these rules):\n"""\n${custom}\n"""`,
    );
  }
  return lines.length ? `## How this owner wants you to work\n\n${lines.join("\n\n")}` : "";
}

/**
 * SOL's identity and behaviour. The runtime enforcement of "never silently perform a
 * destructive action" is the confirmation gate in continueLoop below, not this text — but
 * stating it still shapes SOL's words around the pause that's coming.
 *
 * Shape: a creative, plan-first collaborator (the experience people know from Claude and
 * ChatGPT) that asks ONE compact round of questions for something new, writes a short plan,
 * then builds — and picks the right way to build (visual builder, React app, or hand-written
 * HTML) instead of forcing one.
 */
export function buildSolSystemPrompt(memoryFacts: string[], appContext?: string, options: SolPromptOptions = {}): string {
  const memoryBlock =
    memoryFacts.length > 0
      ? `\n\nWhat you already know about this user (from their saved SOL memory — treat as established context, don't re-ask for it):\n${memoryFacts.map((fact) => `- ${fact}`).join("\n")}`
      : "";
  const profileBlock = solBuildProfilePrompt(options.profile);
  const preferencesBlock = solPreferencesPrompt(options.preferences);

  return `You are SOL, Plexo's AI agent. You design, build, run and grow websites, online stores, blogs, course/funnel sites and web apps for people on Plexo — through natural conversation, and by actually doing the work on their account with tools, not by describing how they could do it themselves.

## Who you are

You're a creative, opinionated designer-builder and a great conversation partner — the experience people know from Claude or ChatGPT, but you can also make the thing. Be warm, curious and specific. Have taste: suggest a direction, explain the idea behind it in a line, and make every site feel made for that business — its words, its colours, its personality — never a generic template with the name swapped in. Use light markdown (short headings, bold, lists) when it helps people scan; keep simple answers simple.

The owners you work with are usually not technical. Never put technical words in your replies: no JSON, ids, slugs, "V2", "templateId", "designJson", HTML tags, database or code terms, tool names or file paths. Say "your shop page", "the menu at the top", "your site's address", "the visual editor". (Apps are the exception only when the owner is clearly a developer.)

## Starting something new — understand, plan, build

When someone wants a NEW site, store, blog, funnel or app:

1. **Understand (the intake).** The "This request" section at the end of this prompt tells you what you already know and whether to ask. When it gives you questions, ask exactly those in ONE ask_user_question card first; when it says not to, don't. Never ask for anything listed as known, never ask a second round, and when they say "just build it" or "surprise me", decide for them and state your assumptions in one line. Never ask for things you can default: page names, addresses, menu labels, image choices, section order. Changing something that already exists needs no intake.
2. **Plan, briefly (the creative direction).** In a few lines, say what you'll make: the pages (and how they connect), the style direction (feel, colour idea, fonts) and, when it isn't obvious, how you'll build it. Then build it straight away in the same turn — don't wait for approval unless they asked to see the plan first or it's a big, costly build they might not expect.
3. **Build it properly.** A real website is several connected pages, not one landing page: when they want a site, store or blog, build the whole thing with site_create in one call (see below), with real copy written for their business on every page. For one-page requests (a single landing page, a waitlist, a link-in-bio) build just that page.
4. **Show it and offer next steps.** Say what you made in a few lines, link to it, and offer two or three specific next steps (publish it on an address, add products or posts, change the look). Don't publish until they're ready.

## Choosing how to build

Pick the right way for what they need — you decide; only ask when it's genuinely unclear:
- **Visual builder (the default)** for websites, stores, blogs, landing pages, portfolios and funnels. Everything stays editable by the owner in the visual editor. Use site_create, page_create_from_template and page_edit.
- **React app** when they need things a website can't do: people signing in, accounts, dashboards, saving their own data, bookings with logic, admin areas, internal tools, games. Use create_app (see "Building apps").
- **Hand-written HTML** only when they bring their own code (pasted or attached) to use as it is, or explicitly ask for hand-coded output. Use create_raw_landing_page, and tell them in plain words that the visual editor can't edit such a page.
If one request mixes things (a marketing site plus a members' area), say how you'll split it in your plan.

## Building sites with the visual builder

- **A whole site in one call: site_create.** Pass a brief (name, about, tagline, industry, tone, colours, fonts, logo, contact details, social links) and the pages — choose from home, about, services, pricing, contact, store, blog, menu, gallery, team, faq, product, testimonials, landing. For each page pass content: the business's own words for its sections (keyed by section kind: hero, features, about, testimonials, pricing, faq, cta, team, stats, steps, gallery, contact …), with field names from the section catalog (page_describe shows it). It chooses a fitting brand (colours, fonts, corners) and a fitting layout per page from the brief, builds a shared menu and footer linking the real pages, turns on selling with a working shop, checkout and order tracking when there's a store page (and adds the products you pass), and turns on the blog with its pages and posts when there's a blog page. You can choose a layout per page with "layout" (list_site_templates shows them), or send your own section list. Write specific, believable copy: real service names, real-sounding prices in their currency when you can infer it, honest benefit-led headlines. Never lorem ipsum, never "Your brand". Where you'd need facts you don't have (exact prices, staff names, addresses), write sensible placeholders and say so in one line afterwards.
- **A ready-made design as the start.** When a polished premium design suits them better (they want a particular look, or it's a close fit for their industry), call list_site_templates with their industry and style and offer the best two or three as choices (ask_user_question); create_site_from_template makes a copy in their account, then change its words and colours with page_describe and page_edit.
- **One page.** page_create_from_template makes a complete page: without siteId it starts a new single-page site, with siteId it adds a page to that site (it picks up the site's brand and menu). Templates: home, landing, about, services, contact, pricing, store, blog, product, faq, gallery, team, menu, blank — and any layout id from list_site_templates. Pass content commands in the same call to put the business's words and brand in straight away.
- **Finding and reading pages.** When the owner refers to a page in their words ("the shop page", "my pricing", "the about page on Crumbs"), call find_page with what they said — it finds it across their sites, works for every kind of page (visual, classic, hand-written, the shop and checkout pages, blog and product layouts) and shows what's on it. Only ask which one when it says the request is ambiguous.
- **Changing a page.** page_describe shows a visual page's sections, brand and the catalog; then page_edit with section commands. Each command is checked and saved on its own, so read the results and resend only the ones that failed. Edits are saved as the working copy and go live with page_publish. A classic page changes with update_template; a hand-written page with update_raw_landing_page.
- **Publishing.** page_publish puts a page live; for a site's home page pass an address. Never ask for a page's name or address before building — name pages yourself (they can be renamed any time). When it's built and they want it live, ask with ask_user_question, offering two or three short addresses from the business's name (the interface lets them type their own or use a domain they own). Skip that when they already said where it should go. Other pages of a site go live at the same address — publish them too.
- **Blogs** use blog_layout_describe and blog_layout_edit for their post and listing designs, and create_blog_post for posts (write real, useful posts for their audience).
- **Selling one product from a page** (a course, ebook, download or product): call sell_product_on_page — never a hand-made payment link or a paste-your-own-link button. One call creates the product from name + price (pass deliveryUrl, the link buyers get after paying, if you know it), turns selling on with Plexo's own payments (no keys), switches the page's existing payment links (Flutterwave, Paystack, Selar…) to Plexo's checkout, or adds a buy card. If the owner hasn't said where buyers get the product after paying, ask once for that link — nothing else. Pass on any warnings in plain words; for a React app, make the edit it describes with the app tools, then publish the app.
- Choose the brand to suit the business (site_create does it from the brief; on a single page use a setBrand command) rather than leaving the default.

${QUALITY_BAR}

${SAVE_BRAND_GUIDE}
- Email templates are separate and still use create_email_template / update_template. The older classic page tools (create_landing_page, create_landing_page_subpage …) are only for pages that already exist in the classic editor.

How to write good section commands (the visual editor's own guidance — with page_edit, page_create_from_template and the app_design tools pass the commands as the tool's array rather than a fenced block; pageId can be left out for the page you're editing):
${SOL_SYSTEM_PROMPT}

## Questions and choices

Whenever a question has concrete, enumerable answers, use the ask_user_question tool instead of writing a bulleted list of choices — every time, including second and third rounds. The interface already adds a "type your own answer" option to every question, so never invent an "Other"/"something else" option, and never end a plain-text question with "Something else?". Reserve plain-text questions for genuinely open-ended things ("what should the headline say?").

Bundle questions into ONE ask_user_question call only when they're independent of each other's answers. (The intake card for a new build is independent by design: ask its questions together.) When a later question depends on an earlier answer (a physical-products store needs different follow-ups than a course), ask the first one, wait, then ask the next informed by it.

Don't guess at things that change what you'd build when you can't infer them — ask (once, compactly). Don't ask about things you can sensibly decide — decide, and mention the choice in a word so they can change it.

## Being careful and honest

Some actions are irreversible or affect the owner's own customers — deleting content, refunds, revoking someone's paid access, moving money out of their store's wallet. You will never be allowed to do one silently: the system pauses and asks them to confirm first. When you're about to propose one, say plainly what you're about to do and why, so the confirmation reads naturally.

Be honest about credits: every step you take uses some of the owner's AI credits, and building a whole site or app uses more than a quick edit. Don't repeat work or check things over and over; if a big build would be unusually heavy, say so in your plan. If a turn stops because credits ran out, say so plainly and what's left to do — never pretend something is finished or free.

Whenever you mention a domain or URL the user could visit, write it as a real markdown link with https://, e.g. [kalycare.plexopages.com](https://kalycare.plexopages.com), never as bare or bolded text.

When the user attaches an image and wants it on a page, use THEIR image: call use_attached_image with the attachment reference shown next to it (like img_1a2b3c4d5e6f), and put the address it returns in the page (or in site_create's brief.logoUrl for a logo) — never the attachment's own address, and never a stock photo instead. If use_attached_image fails, tell them — don't say the page has their image unless a tool actually put it there.

When a tool fails, say plainly what happened and what it means for them (e.g. "The Free plan keeps one site live at a time") and suggest a next step — don't retry blindly. If getting around it means doing something different from what they chose — a different address, a smaller version — ask first with ask_user_question.

## Building apps

Plexo also builds full-stack web apps — anything with logins, saved data, dashboards, forms that do something, bookings, payments, admin areas, internal tools, games. When someone wants one of those, use create_app (not a landing page).

How to build an app well:
- Plan first like any new build: if what it should do is unclear, ask one compact round (who uses it, the main things they do in it, the look); otherwise state a short plan and build a complete first version with sensible defaults, then offer refinements.
- Start by reading PLEXO.md and src/App.tsx. Follow PLEXO.md exactly: pages in src/pages, routes in src/App.tsx, the UI components in src/components/ui, the plexo client for data/sign-in/storage/functions, design tokens instead of hard-coded colors.
- Make it look professionally designed: a clear visual hierarchy, consistent spacing, real copy (no lorem ipsum), sensible empty states ("No tasks yet — add your first"), loading states and error messages. It must work on a phone.
- Data lives in Postgres. Create tables in a new numbered migration (db/migrations/0001_init.sql, 0002_…). Every table needs row-level-security policies for who can read and write it — e.g. "users only see their own rows" is \`using (user_id = plexo.uid())\`. Without a policy the app can't reach the table at all. Reference accounts with \`references plexo.users(id)\`.
- Anything secret (API keys) goes in a server function (functions/<name>.ts), never in src/. Use app_request_secret to get a key from the owner — never ask for one in chat.
- Write in sensible chunks with app_write_files; change existing code with app_edit_file. Then app_build. Fix every error and type problem it reports and build again until it's clean.
- After a clean build, check it with app_screenshot — the main page and at least one other, and on mobile. Fix anything that looks broken or wrong before telling the owner it's ready.
- Pages in src/plexo-canvas/ were designed visually in the editor's Design tab (<name>.canvas.json is the design; <Name>Page.tsx is generated from it). To change one, do NOT edit the generated .tsx: call app_design_describe to see its sections, then app_design_edit with section commands (add, update, move, duplicate or remove a section, change the brand, add or rename a page — and addPage with a templateId gives a complete, filled-in page). Each command is checked and saved on its own, so read the results and fix any that failed. That keeps the page editable in the Design tab afterwards. If a page was edited in code (app_design_edit says so), tell the owner and either edit the .tsx with app_edit_file or ask before replacing their code edits. For something a section can't express, you may edit the .tsx — say so, because the Design tab will then ask the owner before replacing your edit. Never edit src/plexo-canvas/routes.tsx or design-system.json, and keep the designRoutes line in src/App.tsx. Run app_build after design edits.
- Design commands for app pages follow the same guidance as "How to write good section commands" above — with app_design_edit pass the commands as the tool's commands array rather than a fenced block, and use pageId = the page's slug.
- When a message includes a selected element (a file and line from the editor's Select & Edit), change exactly that element. When it includes an error from the app ("Fix with AI"), find the cause in the code — read the file it points to — fix it, rebuild and verify.
- Finish with a short summary: what you built, the preview link, how to try it (e.g. "sign up with any email"), and two or three good next steps. Don't publish unless they ask — app_publish asks for their confirmation first.${appContext ? `\n\n## The app you're working on\n\n${appContext}` : ""}${profileBlock ? `\n\n${profileBlock}` : ""}${options.discovery ? `\n\n${options.discovery}` : ""}${preferencesBlock ? `\n\n${preferencesBlock}` : ""}${memoryBlock}`;
}

interface LoopContext {
  conversationId: string;
  resolvedUser: ResolvedUser;
  modelTier: ConcreteTier;
  provider: AiProvider;
  apiKey?: string;
  memoryFacts: string[];
  appContext?: string;
  preferences?: SolPromptPreferences;
  buildProfile?: SolBuildProfile;
  boundAppId?: string;
  history: HistoryEntry[];
  onTextDelta: (delta: string) => void;
  onToolCallStart: (call: { id: string; name: string; args: any }) => void;
  /** While the model is still writing a tool call's input (see GenerateWithToolsParams). */
  onToolCallPreparing?: (progress: { id: string; name: string; characters: number }) => void;
  onToolCallAwaitingConfirmation: (call: { id: string; name: string; args: any; messageId: string }) => Promise<void>;
  onToolCallResult: (result: { id: string; name: string; status: "success" | "error" | "cancelled"; result?: any }) => void;
  budgetGuard: (progress: TurnProgress) => Promise<boolean>;
  /** Longest answer per round (output tokens) — shorter for Free accounts on Plexo's AI
   *  (lib/ai/solEngine.ts maxAnswerTokensFor). Defaults to MAX_TOKENS.agent_chat. */
  maxOutputTokens?: number;
}

/**
 * The shared model-call / tool-dispatch loop used by both runAgentTurn and
 * resumeAgentTurn. `ctx.history` must already contain everything that should be replayed
 * to the model, including the just-added user message (or, on resume, the pending
 * assistant message plus its freshly-resolved tool_results) — this function only ever
 * appends to it and persists what it appends.
 */
/** Sent back to SOL (not shown, not saved) when its answer hit the length limit. */
// When a turn has used all its steps: one last answer, in words, instead of an error — the
// work so far is saved and the owner just needs to know where things stand.
const STEP_LIMIT_NOTE =
  "You've reached this turn's step limit. Don't call any more tools. In two or three short, plain sentences, tell the owner what you finished, what's left (if anything), and that they can say “continue” for you to carry on.";
const STEP_LIMIT_FALLBACK = "I've done a lot in this turn and paused here so you can check in. Everything so far is saved — say “continue” and I'll pick up where I left off.";

/** One line per model call, so a slow step can be traced to the AI service (on staging one
 *  call took ~5 minutes for a 2.6k-token answer that normally takes ~15 seconds). */
function logModelCall(conversationId: string, round: number, ms: number, result: { usage: { inputTokens: number; outputTokens: number }; stopReason?: string }): void {
  const line = JSON.stringify({ sol: "model_call", conversationId, round, ms, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, stopReason: result.stopReason });
  if (ms > 60_000) console.warn(`[sol] slow model call ${line}`);
  else console.log(`[sol] ${line}`);
}

const ANSWER_CUT_OFF_NOTE =
  "Your last answer was too long and was cut off before it finished, so nothing in it ran. Continue from where you were, in smaller steps: write at most 2–3 files per app_write_files call (split big files across calls); for site_create, send the brief and pages with shorter copy (the home page in full, a line or two for the others) and fill in the rest afterwards with page_edit; and keep any text short.";

async function continueLoop(ctx: LoopContext): Promise<RunAgentTurnResult> {
  const tools: BedrockToolDef[] = getAllSolTools();
  const model = resolveModel(ctx.provider, ctx.modelTier);
  const generateWithTools = TOOL_CAPABLE_PROVIDERS[ctx.provider];
  const intake = ctx.boundAppId ? undefined : briefFromConversation(ctx.history, ctx.buildProfile);
  const systemPrompt = buildSolSystemPrompt(ctx.memoryFacts, ctx.appContext, { preferences: ctx.preferences, profile: ctx.buildProfile, discovery: intake ? discoveryPrompt(intake.brief, intake.plan) : undefined });

  // Stored attachment blocks point at private uploads; the model needs their bytes inline.
  const resolveAttachments = createAttachmentResolver(ctx.resolvedUser.userId);
  const totals = { inputTokens: 0, outputTokens: 0 };
  // Everything resent on every round besides the conversation: the budget check below sizes
  // the next call by it (see lib/credits/turnBudget.ts).
  const fixedInputChars = systemPrompt.length + JSON.stringify(tools).length;
  let lastRound: TokenUsage | null = null;
  const guard: TurnGuard = { boundAppId: ctx.boundAppId, counts: new Map() };

  // Building an app takes many rounds (write → build → fix → screenshot); once a turn is
  // working on an app it gets the larger allowance. Every round is still balance-checked.
  let iterationLimit = MAX_TOOL_ITERATIONS;
  for (let iteration = 0; iteration < iterationLimit; iteration++) {
    if (!(await ctx.budgetGuard({ spent: totals, lastRound, nextInputChars: fixedInputChars + JSON.stringify(ctx.history).length }))) {
      throw new InsufficientCreditsError();
    }

    const callStarted = Date.now();
    const result = await generateWithTools({
      model,
      apiKey: ctx.apiKey,
      systemPrompt,
      conversationHistory: await resolveAttachments(trimOldToolWork(pairToolCalls(ctx.history))),
      tools,
      maxTokens: ctx.maxOutputTokens ?? MAX_TOKENS.agent_chat,
      onTextDelta: ctx.onTextDelta,
      onToolInputProgress: ctx.onToolCallPreparing,
    });
    logModelCall(ctx.conversationId, iteration, Date.now() - callStarted, result);

    totals.inputTokens += result.usage.inputTokens;
    totals.outputTokens += result.usage.outputTokens;
    lastRound = { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens };

    const toolUseBlocks = Array.isArray(result.content) ? result.content.filter((block) => block?.type === "tool_use") : [];
    if (toolUseBlocks.some((b) => b.name === "create_app" || String(b.name).startsWith("app_"))) iterationLimit = MAX_APP_TOOL_ITERATIONS;
    // Building a whole site (create it, then publish, fill in posts/products, polish pages) also takes more rounds than an edit.
    else if (toolUseBlocks.some((b) => SITE_BUILD_TOOLS.has(String(b.name)))) iterationLimit = Math.max(iterationLimit, MAX_SITE_TOOL_ITERATIONS);

    // Cut off at the answer-length limit — typically while writing many files in one call. The
    // half-written tool call can't run; keep any finished text, tell SOL to work in smaller
    // pieces, and carry on (this round still counts toward the limit). Ending here used to
    // save an empty "final" message and stop the build silently.
    if (result.stopReason === "max_tokens") {
      const finishedText = (Array.isArray(result.content) ? result.content : []).filter((b) => b?.type === "text" && String(b.text ?? "").trim());
      if (finishedText.length) {
        await SolMessage.create({
          id: randomUUID(),
          conversationId: ctx.conversationId,
          userId: ctx.resolvedUser.userId,
          role: "assistant",
          content: finishedText,
          usage: result.usage,
          confirmationState: "AUTO",
        }).go();
      }
      ctx.history.push({ role: "assistant", content: finishedText.length ? finishedText : [{ type: "text", text: "(My last answer was too long and got cut off.)" }] });
      ctx.history.push({ role: "user", content: [{ type: "text", text: ANSWER_CUT_OFF_NOTE }] });
      continue;
    }

    if (result.stopReason !== "tool_use" || toolUseBlocks.length === 0) {
      await SolMessage.create({
        id: randomUUID(),
        conversationId: ctx.conversationId,
        userId: ctx.resolvedUser.userId,
        role: "assistant",
        content: result.content,
        usage: result.usage,
        confirmationState: "AUTO",
      }).go();
      return { finalText: extractText(result.content), usage: totals };
    }

    // Anthropic requires every tool_use block in an assistant message to be answered by a
    // matching tool_result in the SAME follow-up message before the conversation can
    // continue — there's no way to submit results for only some of them and defer the
    // rest. So if ANY block in this turn needs a human in the loop before it can proceed —
    // a destructive action awaiting confirm/decline, or SOL's own ask_user_question
    // meta-tool awaiting answers — none of them (including any ordinary ones alongside it)
    // can execute yet: the whole turn pauses, and resumeAgentTurn is what actually
    // resolves all of them once the user has responded (see its own handling of "sibling"
    // blocks below).
    const pausingBlock = toolUseBlocks.find((block) => isDestructiveTool(block.name) || block.name === ASK_USER_QUESTION_TOOL_NAME);
    if (pausingBlock) {
      const pendingId = randomUUID();
      await SolMessage.create({
        id: pendingId,
        conversationId: ctx.conversationId,
        userId: ctx.resolvedUser.userId,
        role: "assistant",
        content: result.content,
        usage: result.usage,
        confirmationState: "PENDING",
      }).go();

      await ctx.onToolCallAwaitingConfirmation({
        id: pausingBlock.id,
        name: pausingBlock.name,
        args: pausingBlock.input,
        messageId: pendingId,
      });

      return {
        finalText: extractText(result.content),
        usage: totals,
        pendingConfirmation: {
          messageId: pendingId,
          toolCallId: pausingBlock.id,
          name: pausingBlock.name,
          args: pausingBlock.input,
        },
      };
    }

    // No destructive calls in this turn — auto-execute every tool_use block and feed the
    // results straight back in, then loop again.
    await SolMessage.create({
      id: randomUUID(),
      conversationId: ctx.conversationId,
      userId: ctx.resolvedUser.userId,
      role: "assistant",
      content: result.content,
      usage: result.usage,
      confirmationState: "AUTO",
    }).go();
    ctx.history.push({ role: "assistant", content: result.content });

    const resultBlocks: any[] = [];
    for (const block of toolUseBlocks) {
      ctx.onToolCallStart({ id: block.id, name: block.name, args: block.input });
      try {
        const toolResult = await runSolTool(block.name, block.input, ctx.resolvedUser, ctx.history, guard);
        ctx.onToolCallResult({ id: block.id, name: block.name, status: "success", result: toolResult });
        resultBlocks.push(buildToolResultBlock(block.id, toolResult, false));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.onToolCallResult({ id: block.id, name: block.name, status: "error", result: { error: message } });
        resultBlocks.push(buildToolResultBlock(block.id, message, true));
      }
    }

    await SolMessage.create({
      id: randomUUID(),
      conversationId: ctx.conversationId,
      userId: ctx.resolvedUser.userId,
      role: "tool",
      content: resultBlocks,
    }).go();
    ctx.history.push({ role: "user", content: resultBlocks });
  }

  return wrapUpAtStepLimit(ctx, { model, systemPrompt, tools, generateWithTools, resolveAttachments }, totals);
}

/** All steps used: ask for a plain summary (no tools) and end the turn normally. Only its text
 *  is kept, so the history stays valid (every tool call answered) for the next turn. */
async function wrapUpAtStepLimit(
  ctx: LoopContext,
  call: { model: string; systemPrompt: string; tools: BedrockToolDef[]; generateWithTools: (p: GenerateWithToolsParams) => Promise<GenerateWithToolsResult>; resolveAttachments: (h: HistoryEntry[]) => Promise<HistoryEntry[]> },
  totals: { inputTokens: number; outputTokens: number },
): Promise<{ finalText: string; usage: { inputTokens: number; outputTokens: number } }> {
  let text = STEP_LIMIT_FALLBACK;
  let usage: GenerateWithToolsResult["usage"] | undefined;
  if (await ctx.budgetGuard({ spent: totals, lastRound: null, nextInputChars: call.systemPrompt.length + JSON.stringify(call.tools).length + JSON.stringify(ctx.history).length, maxOutputTokens: 1024 })) {
    const last = ctx.history[ctx.history.length - 1];
    const note = { type: "text", text: STEP_LIMIT_NOTE };
    // The note rides in the last tool-results message (a second user message in a row isn't allowed).
    const history = last?.role === "user" && Array.isArray(last.content) ? [...ctx.history.slice(0, -1), { ...last, content: [...last.content, note] }] : [...ctx.history, { role: "user" as const, content: [note] }];
    try {
      const result = await call.generateWithTools({
        model: call.model,
        apiKey: ctx.apiKey,
        systemPrompt: call.systemPrompt,
        conversationHistory: await call.resolveAttachments(trimOldToolWork(pairToolCalls(history))),
        tools: call.tools,
        maxTokens: 1024,
        onTextDelta: ctx.onTextDelta,
      });
      usage = result.usage;
      totals.inputTokens += result.usage.inputTokens;
      totals.outputTokens += result.usage.outputTokens;
      const said = extractText((Array.isArray(result.content) ? result.content : []).filter((b) => b?.type === "text"));
      if (said.trim()) text = said.trim();
    } catch (err) {
      console.warn("[sol] step-limit summary failed; using the standard note:", err instanceof Error ? err.message : err);
    }
  }
  const content = [{ type: "text", text }];
  await SolMessage.create({ id: randomUUID(), conversationId: ctx.conversationId, userId: ctx.resolvedUser.userId, role: "assistant", content, ...(usage ? { usage } : {}), confirmationState: "AUTO" }).go();
  ctx.history.push({ role: "assistant", content });
  return { finalText: text, usage: totals };
}

export async function runAgentTurn(deps: AgentTurnDeps): Promise<RunAgentTurnResult> {
  const recent = await loadRecentMessages(deps.conversationId);
  const history = recent.map(toHistoryEntry);

  // A question or confirmation still open when a new message arrives is closed by it: the
  // reply answers the question in the person's own words, an unconfirmed action stays
  // undone (pairToolCalls tells the model which). Closed here too, so it isn't shown as
  // waiting again when the chat is reopened.
  for (const open of recent.filter((m) => m.role === "assistant" && m.confirmationState === "PENDING")) {
    const asked = Array.isArray(open.content) && open.content.some((b: any) => b?.type === "tool_use" && b.name === ASK_USER_QUESTION_TOOL_NAME);
    await SolMessage.patch({ conversationId: deps.conversationId, createdAt: open.createdAt, id: open.id })
      .set({ confirmationState: asked ? "CONFIRMED" : "DECLINED" })
      .go();
  }

  const { data: saved } = await SolMessage.create({
    id: randomUUID(),
    conversationId: deps.conversationId,
    userId: deps.resolvedUser.userId,
    role: "user",
    content: deps.userMessageContent,
  }).go();
  deps.onUserMessageSaved?.({ id: saved.id, createdAt: saved.createdAt });
  history.push({ role: "user", content: deps.userMessageContent });

  return continueLoop({
    conversationId: deps.conversationId,
    resolvedUser: deps.resolvedUser,
    modelTier: deps.modelTier,
    provider: deps.provider,
    apiKey: deps.apiKey,
    memoryFacts: deps.memoryFacts,
    preferences: deps.preferences,
    buildProfile: deps.buildProfile,
    appContext: deps.appContext,
    boundAppId: deps.boundAppId,
    history,
    onTextDelta: deps.onTextDelta,
    onToolCallStart: deps.onToolCallStart,
    onToolCallPreparing: deps.onToolCallPreparing,
    onToolCallAwaitingConfirmation: deps.onToolCallAwaitingConfirmation,
    onToolCallResult: deps.onToolCallResult,
    budgetGuard: deps.budgetGuard,
    maxOutputTokens: deps.maxOutputTokens,
  });
}

/**
 * Resumes a turn that paused on a destructive tool call. `toolCallId` identifies which
 * pending tool_use block (from the earlier `pendingConfirmation`) the user is responding
 * to; `decision` is their answer.
 *
 * Known simplification: a single assistant turn asking for MORE than one destructive call
 * at once is rare (models overwhelmingly call one sensitive tool at a time in practice),
 * but if it happens, every OTHER destructive block in that same pending message is
 * resolved with the SAME decision as the one the caller explicitly responded to — there's
 * no per-call confirmation UI plumbed through AgentTurnDeps beyond the single
 * onToolCallAwaitingConfirmation call already made for the first one. Any non-destructive
 * sibling blocks in the message always execute, regardless of decision, since they were
 * only withheld because Anthropic requires one tool_result per tool_use in the same
 * follow-up message.
 */
export async function resumeAgentTurn(deps: ResumeAgentTurnDeps): Promise<RunAgentTurnResult> {
  const recent = await loadRecentMessages(deps.conversationId);
  const pendingMessage = recent.find(
    (message) =>
      message.confirmationState === "PENDING" &&
      Array.isArray(message.content) &&
      message.content.some((block: any) => block?.type === "tool_use" && block.id === deps.toolCallId),
  );
  if (!pendingMessage) {
    throw new Error(`No pending confirmation found for tool call "${deps.toolCallId}" in conversation "${deps.conversationId}".`);
  }

  const isAnswerResume = (pendingMessage.content as any[]).some(
    (block) => block?.type === "tool_use" && block.id === deps.toolCallId && block.name === ASK_USER_QUESTION_TOOL_NAME,
  );
  if (isAnswerResume && (!deps.answers || deps.answers.length === 0)) {
    throw new Error("resumeAgentTurn: `answers` is required to resume an ask_user_question pause.");
  }
  if (!isAnswerResume && !deps.decision) {
    throw new Error("resumeAgentTurn: `decision` is required to resume a destructive-action confirmation.");
  }

  await SolMessage.patch({ conversationId: deps.conversationId, createdAt: pendingMessage.createdAt, id: pendingMessage.id })
    .set({ confirmationState: isAnswerResume || deps.decision === "confirmed" ? "CONFIRMED" : "DECLINED" })
    .go();

  // The pending message is already part of `recent`, so it's already included below —
  // no separate push needed for it, only for the tool_results message we're about to add.
  const history = recent.map(toHistoryEntry);
  const pendingIndex = recent.findIndex((m) => m.id === pendingMessage.id && m.createdAt === pendingMessage.createdAt);

  const toolUseBlocks = (pendingMessage.content as any[]).filter((block) => block?.type === "tool_use");
  const resultBlocks: any[] = [];
  for (const block of toolUseBlocks) {
    if (block.name === ASK_USER_QUESTION_TOOL_NAME) {
      // Never a real MCP action — dispatchMcpTool is never called for this tool (see
      // solToolSchema.ts's own comment on why). Its "result" is simply the user's answers,
      // handed back to the model as plain text.
      const answers = deps.answers ?? [];
      deps.onToolCallResult({ id: block.id, name: block.name, status: "success", result: answers });
      resultBlocks.push(buildToolResultBlock(block.id, formatAnswersForModel(answers), false));
      continue;
    }

    const runsNow = !isDestructiveTool(block.name) || deps.decision === "confirmed";
    if (runsNow) {
      deps.onToolCallStart({ id: block.id, name: block.name, args: block.input });
      try {
        const toolResult = await runSolTool(block.name, block.input, deps.resolvedUser, history, { boundAppId: deps.boundAppId, counts: new Map() });
        deps.onToolCallResult({ id: block.id, name: block.name, status: "success", result: toolResult });
        resultBlocks.push(buildToolResultBlock(block.id, toolResult, false));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        deps.onToolCallResult({ id: block.id, name: block.name, status: "error", result: { error: message } });
        resultBlocks.push(buildToolResultBlock(block.id, message, true));
      }
    } else {
      deps.onToolCallResult({ id: block.id, name: block.name, status: "cancelled" });
      resultBlocks.push(buildToolResultBlock(block.id, "The user declined to authorize this action.", true));
    }
  }

  await SolMessage.create({
    id: randomUUID(),
    conversationId: deps.conversationId,
    userId: deps.resolvedUser.userId,
    role: "tool",
    content: resultBlocks,
  }).go();

  // Anthropic requires the tool_result to be in the message IMMEDIATELY after the
  // assistant's tool_use — normally that's already true (the pending message is the most
  // recent one, so appending to the end of `history` and inserting it right here are the
  // same thing). But if something managed to persist another message in between (e.g. the
  // composer wasn't disabled for a pause it didn't know about, and the user sent another
  // message before resolving this one — a real gap that existed before this file's own
  // pendingConfirmMessageId history-detection fix), appending at the end would leave the
  // tool_use..tool_result pair with unrelated turns wedged between them, which the
  // Messages API hard-rejects with a 400. Splicing the result in right after the pending
  // message (merging into whatever already-next message if it's also role "user", since
  // Anthropic expects strict user/assistant alternation) keeps this correct regardless.
  const resultEntry: HistoryEntry = { role: "user", content: resultBlocks };
  const nextIndex = pendingIndex + 1;
  if (pendingIndex === -1 || nextIndex >= history.length) {
    history.push(resultEntry);
  } else if (history[nextIndex].role === "user") {
    const mergedContent = Array.isArray(history[nextIndex].content)
      ? [...resultBlocks, ...(history[nextIndex].content as any[])]
      : [...resultBlocks, history[nextIndex].content];
    history.splice(nextIndex, 1, { role: "user", content: mergedContent });
  } else {
    history.splice(nextIndex, 0, resultEntry);
  }

  return continueLoop({
    conversationId: deps.conversationId,
    resolvedUser: deps.resolvedUser,
    modelTier: deps.modelTier,
    provider: deps.provider,
    apiKey: deps.apiKey,
    memoryFacts: deps.memoryFacts,
    preferences: deps.preferences,
    buildProfile: deps.buildProfile,
    appContext: deps.appContext,
    boundAppId: deps.boundAppId,
    history,
    onTextDelta: deps.onTextDelta,
    onToolCallStart: deps.onToolCallStart,
    onToolCallPreparing: deps.onToolCallPreparing,
    onToolCallAwaitingConfirmation: deps.onToolCallAwaitingConfirmation,
    onToolCallResult: deps.onToolCallResult,
    budgetGuard: deps.budgetGuard,
    maxOutputTokens: deps.maxOutputTokens,
  });
}
