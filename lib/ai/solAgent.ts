import { randomUUID } from "node:crypto";
import type { EntityItem } from "electrodb";

import { dispatchMcpTool, type ResolvedUser } from "@/lib/mcp/dispatchMcpTool";
import { isDestructiveTool } from "@/lib/mcp/toolRiskClassification";
import { generateWithTools } from "@/lib/ai/providers/bedrockClaude";
import { getAllSolTools, ASK_USER_QUESTION_TOOL_NAME, type BedrockToolDef } from "@/lib/ai/solToolSchema";
import { resolveModel } from "@/lib/ai/modelRegistry";
import { MAX_TOKENS } from "@/lib/ai/generate";
import { MAX_TOOL_ITERATIONS } from "@/lib/credits/agentTurnEstimate";
import type { ConcreteTier } from "@/lib/ai/types";
import { SolMessage } from "@/lib/db/solEntities";

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
  constructor(message = `SOL couldn't finish this action within ${MAX_TOOL_ITERATIONS} tool-call rounds.`) {
    super(message);
    this.name = "AgentIterationLimitError";
  }
}

export interface AgentTurnDeps {
  conversationId: string;
  resolvedUser: ResolvedUser;
  modelTier: ConcreteTier;
  /** Bedrock/Anthropic content blocks (text, image, document refs) for the new user message. */
  userMessageContent: any[];
  memoryFacts: string[];
  onTextDelta: (delta: string) => void;
  onToolCallStart: (call: { id: string; name: string; args: any }) => void;
  /** `messageId` is the PENDING SolMessage row's own id — the client needs it (not just the
   * Anthropic tool_use id) to actually resume the turn (see the confirm/answer routes),
   * and sending it in this same callback/frame is what lets the client act on a pause the
   * instant it arrives, with no separate follow-up fetch (and the race that came with
   * one — see SolChatView's own comment on why that follow-up fetch was removed). */
  onToolCallAwaitingConfirmation: (call: { id: string; name: string; args: any; messageId: string }) => Promise<void>;
  onToolCallResult: (result: { id: string; name: string; status: "success" | "error" | "cancelled"; result?: any }) => void;
  /** Re-checks credit balance before each model call; false stops the loop. */
  budgetGuard: () => Promise<boolean>;
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
  /** The tool_use id (from the earlier pendingConfirmation) the user is responding to. */
  toolCallId: string;
  /** Required unless the pending tool call is ask_user_question, in which case `answers`
   * is required instead — see the loop below. */
  decision?: "confirmed" | "declined";
  /** Required only when resuming an ask_user_question pause. */
  answers?: AskUserAnswer[];
  memoryFacts: string[];
  onTextDelta: (delta: string) => void;
  onToolCallStart: (call: { id: string; name: string; args: any }) => void;
  onToolCallAwaitingConfirmation: (call: { id: string; name: string; args: any; messageId: string }) => Promise<void>;
  onToolCallResult: (result: { id: string; name: string; status: "success" | "error" | "cancelled"; result?: any }) => void;
  budgetGuard: () => Promise<boolean>;
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
  return {
    type: "tool_result",
    tool_use_id: toolUseId,
    content: typeof output === "string" ? output : JSON.stringify(output ?? null),
    is_error: isError,
  };
}

/** Renders the user's answers back as plain text for the model — the same "replay
 * verbatim, keep it human-readable" spirit as every other tool_result in this file. */
function formatAnswersForModel(answers: AskUserAnswer[]): string {
  if (answers.length === 0) return "The user didn't provide any answers.";
  return answers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join("\n\n");
}

/**
 * A clear, well-scoped identity/behavior prompt for SOL. The runtime enforcement of "never
 * silently perform a destructive action" is the confirmation gate in continueLoop below,
 * not this instruction — but stating it here still matters: it shapes the assistant's
 * TEXT (e.g. "I'll delete this product — just to confirm, that's the one called X?")
 * around the fact that a pause is coming, instead of talking as if the action already
 * silently happened.
 */
function buildSolSystemPrompt(memoryFacts: string[]): string {
  const memoryBlock =
    memoryFacts.length > 0
      ? `\n\nWhat you already know about this user (from their saved SOL memory — treat as established context, don't re-ask for it):\n${memoryFacts.map((fact) => `- ${fact}`).join("\n")}`
      : "";

  return `You are SOL, Plexo's AI agent. You help people build, manage, and grow their landing pages, blogs, online stores, and course/funnel sites on Plexo — through natural conversation, and by actually taking action on their account via tools, not just describing how they'd do it themselves.

Be direct, warm, and conversational — like a sharp, helpful teammate, never a generic corporate chatbot. Vary your phrasing, keep replies focused, and don't pad answers with filler or over-explain steps the user didn't ask about.

When what the user wants implies a concrete action Plexo can actually do, take it with the available tools instead of just explaining how they could do it manually — e.g. "I want to sell a course" means create the Funnel and its pages, not a description of the Funnel feature. Ask a clarifying question first only when the request is genuinely ambiguous (which site, which product, what should it say) — don't ask when a reasonable default is obvious.

Whenever a clarifying question has concrete, enumerable answers — even just one question with a short list of options — use the ask_user_question tool instead of writing it out as plain text with a bulleted list of choices. This applies every time, not just the first time you ask something in a conversation: a second or third round of follow-up questions deserves the exact same interactive treatment as the first, never a reversion to plain-text bullets just because the conversation is already underway. It renders as an interactive prompt the user can click through instead of having to type a paragraph back, and the interface already adds a "type your own answer" option to every question, so never invent an "Other"/"something else" option yourself, and never end a plain-text question with something like "Something else?" as if it were one more bullet — that's a sign the question belonged in the tool. Reserve actual plain-text questions for something genuinely open-ended with no natural set of options at all (e.g. "what should the page's headline say?").

Only bundle multiple questions into ONE ask_user_question call when they're genuinely independent — each one makes sense and stays relevant no matter how the others get answered. The moment a later question's relevance, phrasing, or options actually depend on how an earlier one is answered (e.g. you'd ask something different about a physical-products store than a course/membership site), don't pre-plan the whole sequence up front — ask the one question you actually need right now, wait for the real answer, and only then decide the next question (in a follow-up ask_user_question call, informed by what they just told you). A batch of pre-templated questions that ignores the answer to question 1 when writing questions 2 and 3 is worse than asking one at a time.

Some actions are irreversible or affect the user's own customers directly — deleting content, issuing a refund, revoking someone's paid access, moving money out of their store's wallet. You will never be allowed to perform one of those silently: the system pauses and asks the person to explicitly confirm before it actually runs, no matter what you decide to call. Write your responses with that in mind — when you're about to propose one of these, say plainly what you're about to do and why, so the confirmation prompt reads naturally rather than as a surprise.

Whenever you mention a domain or URL — a site you just published, an existing page, anything the user could actually visit — always write it as a real markdown link with an explicit https:// scheme, e.g. [kalycare.plexopages.com](https://kalycare.plexopages.com), never as bare/bolded text like **kalycare.plexopages.com**. The chat only turns actual markdown links into clickable ones; plain text next to a domain-shaped word is not automatically linkified.

Plexo can build a brand-new landing page two genuinely different ways, and neither is the "default" — ask which one the user wants (via ask_user_question) before creating it, unless they've already made this obvious themselves (e.g. they said "use your drag-and-drop builder", or they pasted/attached their own HTML to use as-is). Phrase the question and options in plain terms the user actually cares about, never the internal tool/field names below:
- A drag-and-drop BUILDER page (create_landing_page/publish_landing_page, designJson) — editable afterward with Plexo's own visual, drag-and-drop editor. Frame this as the easy, flexible choice for a page they'll want to keep tweaking themselves later.
- A page built from real, hand-crafted HTML/CSS you write directly (create_raw_landing_page/publish_raw_landing_page, htmlContent) — served byte-for-byte exactly as written, not editable in the visual builder afterward. Frame this as the premium, fully custom option: it's what unlocks the most design freedom and the most polished, professional-grade finish, since nothing is constrained to the builder's block system — better for someone who wants their site to feel bespoke rather than editable.

If a tool call fails, explain what went wrong in plain terms and suggest a next step — don't just retry blindly.${memoryBlock}`;
}

interface LoopContext {
  conversationId: string;
  resolvedUser: ResolvedUser;
  modelTier: ConcreteTier;
  memoryFacts: string[];
  history: HistoryEntry[];
  onTextDelta: (delta: string) => void;
  onToolCallStart: (call: { id: string; name: string; args: any }) => void;
  onToolCallAwaitingConfirmation: (call: { id: string; name: string; args: any; messageId: string }) => Promise<void>;
  onToolCallResult: (result: { id: string; name: string; status: "success" | "error" | "cancelled"; result?: any }) => void;
  budgetGuard: () => Promise<boolean>;
}

/**
 * The shared model-call / tool-dispatch loop used by both runAgentTurn and
 * resumeAgentTurn. `ctx.history` must already contain everything that should be replayed
 * to the model, including the just-added user message (or, on resume, the pending
 * assistant message plus its freshly-resolved tool_results) — this function only ever
 * appends to it and persists what it appends.
 */
async function continueLoop(ctx: LoopContext): Promise<RunAgentTurnResult> {
  const tools: BedrockToolDef[] = getAllSolTools();
  const model = resolveModel("bedrock_claude", ctx.modelTier);
  const systemPrompt = buildSolSystemPrompt(ctx.memoryFacts);

  const totals = { inputTokens: 0, outputTokens: 0 };

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    if (!(await ctx.budgetGuard())) {
      throw new InsufficientCreditsError();
    }

    const result = await generateWithTools({
      model,
      systemPrompt,
      conversationHistory: ctx.history,
      tools,
      maxTokens: MAX_TOKENS.agent_chat,
      onTextDelta: ctx.onTextDelta,
    });

    totals.inputTokens += result.usage.inputTokens;
    totals.outputTokens += result.usage.outputTokens;

    const toolUseBlocks = Array.isArray(result.content) ? result.content.filter((block) => block?.type === "tool_use") : [];

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
        const toolResult = await dispatchMcpTool(block.name, block.input, ctx.resolvedUser);
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

  throw new AgentIterationLimitError();
}

export async function runAgentTurn(deps: AgentTurnDeps): Promise<RunAgentTurnResult> {
  const recent = await loadRecentMessages(deps.conversationId);
  const history = recent.map(toHistoryEntry);

  await SolMessage.create({
    id: randomUUID(),
    conversationId: deps.conversationId,
    userId: deps.resolvedUser.userId,
    role: "user",
    content: deps.userMessageContent,
  }).go();
  history.push({ role: "user", content: deps.userMessageContent });

  return continueLoop({
    conversationId: deps.conversationId,
    resolvedUser: deps.resolvedUser,
    modelTier: deps.modelTier,
    memoryFacts: deps.memoryFacts,
    history,
    onTextDelta: deps.onTextDelta,
    onToolCallStart: deps.onToolCallStart,
    onToolCallAwaitingConfirmation: deps.onToolCallAwaitingConfirmation,
    onToolCallResult: deps.onToolCallResult,
    budgetGuard: deps.budgetGuard,
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
        const toolResult = await dispatchMcpTool(block.name, block.input, deps.resolvedUser);
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
    memoryFacts: deps.memoryFacts,
    history,
    onTextDelta: deps.onTextDelta,
    onToolCallStart: deps.onToolCallStart,
    onToolCallAwaitingConfirmation: deps.onToolCallAwaitingConfirmation,
    onToolCallResult: deps.onToolCallResult,
    budgetGuard: deps.budgetGuard,
  });
}
