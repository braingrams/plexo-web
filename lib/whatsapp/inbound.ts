import { OUT_OF_CREDITS_LINKS } from "@/lib/credits/upgradeOffer";
import { randomUUID } from "node:crypto";

import { prepareMessagesTurn, prepareConfirmTurn, humanizeToolName, type StreamFrame, type TurnEmitter } from "@/lib/ai/solChatHandler";
import { ASK_USER_QUESTION_TOOL_NAME } from "@/lib/ai/solToolSchema";
import { resolveUserById } from "@/lib/auth/resolveUserById";
import { SolConversation, SolMessage, SolPreferences } from "@/lib/db/solEntities";
import { savePhoneToProfile } from "@/lib/profile/phone";
import { WhatsAppLink, WhatsAppLinkCode, WhatsAppMessage, WhatsAppUserLink } from "@/lib/db/whatsappEntities";
import { sendTypingIndicator, sendWhatsAppText, type InboundWhatsAppMessage } from "./cloudApi";
import { appBaseUrl, SOL_SETTINGS_PATH } from "./config";
import { markdownToWhatsApp, splitForWhatsApp } from "./format";
import { prepareMedia, UNSUPPORTED_MEDIA_TEXT, type PreparedMedia } from "./media";

// One inbound WhatsApp message, start to finish: who is this → what are they asking → run it through the
// very same SOL turn the dashboard uses (credits, memory, tools, permissions all identical) → text back.
// Runs inside the SOL Lambda (long timeout), never inside the webhook request — Meta wants its 200 in seconds.

// ---- tiny pure helpers (unit-tested) ----------------------------------------------------------------

export type Command = { kind: "link"; code: string } | { kind: "stop" } | { kind: "new" } | { kind: "help" } | null;

export function parseCommand(text: string): Command {
  const t = text.trim();
  const link = t.match(/^link\s+(\d{6})$/i);
  if (link) return { kind: "link", code: link[1] };
  if (/^(stop|unlink|disconnect)$/i.test(t)) return { kind: "stop" };
  if (/^(new|new chat|reset|start over)$/i.test(t)) return { kind: "new" };
  if (/^(help|\?|menu)$/i.test(t)) return { kind: "help" };
  return null;
}

export function parseDecision(text: string): "confirmed" | "declined" | null {
  const t = text.trim().toLowerCase().replace(/[.!]+$/, "");
  if (/^(yes|y|yep|yeah|yup|confirm|confirmed|ok|okay|sure|go ahead|do it|proceed|👍)$/.test(t)) return "confirmed";
  if (/^(no|n|nope|cancel|stop|don'?t|do not|decline|👎)$/.test(t)) return "declined";
  return null;
}

/** Maps a typed reply onto SOL's structured questions: "2" picks option 2; several lines answer several questions. */
export function answersFor(questions: Array<{ question: string; options?: Array<{ label: string }> }>, text: string): Array<{ question: string; answer: string }> {
  const resolveOne = (q: (typeof questions)[number], raw: string): string => {
    const n = Number(raw.trim().replace(/[.)]$/, ""));
    if (Number.isInteger(n) && q.options && n >= 1 && n <= q.options.length) return q.options[n - 1].label;
    return raw.trim();
  };
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (questions.length > 1 && lines.length === questions.length) return questions.map((q, i) => ({ question: q.question, answer: resolveOne(q, lines[i]) }));
  return questions.map((q) => ({ question: q.question, answer: resolveOne(q, text) }));
}

function summarizeArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const rows: string[] = [];
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (/id$/i.test(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      const v = String(value).replace(/\s+/g, " ");
      rows.push(`• ${key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ")}: ${v.length > 80 ? v.slice(0, 77) + "…" : v}`);
    }
    if (rows.length >= 4) break;
  }
  return rows.join("\n");
}

export function confirmationPrompt(name: string, args: unknown): string {
  const details = summarizeArgs(args);
  return `⚠️ **SOL wants to ${humanizeToolName(name).toLowerCase()}**${details ? `\n${details}` : ""}\n\nReply **YES** to go ahead or **NO** to cancel.`;
}

export function questionPrompt(questions: Array<{ question: string; options?: Array<{ label: string; description?: string }> }>): string {
  const body = questions
    .map((q, i) => {
      const options = (q.options ?? []).map((o, j) => `  ${j + 1}. ${o.label}${o.description ? ` — ${o.description}` : ""}`).join("\n");
      return `${questions.length > 1 ? `**${i + 1}.** ` : ""}${q.question}${options ? `\n${options}` : ""}`;
    })
    .join("\n\n");
  const how = questions.length > 1 ? "Reply with one answer per line (a number or your own words)." : (questions[0]?.options?.length ?? 0) > 0 ? "Reply with a number, or type your own answer." : "Just reply with your answer.";
  return `${body}\n\n_${how}_`;
}

const HELP_TEXT =
  "**SOL on WhatsApp**\nJust tell me what you want done — type it, send a voice note, or share a photo or document. For example:\n• How did my store do this week?\n• Add a 10% discount code LAUNCH\n• Publish my new landing page\n\n" +
  "Commands:\n• **NEW** — start a fresh conversation\n• **STOP** — disconnect this number from Plexo\n• **HELP** — show this again";

function notLinkedText(): string {
  return `Hi! I'm SOL, Plexo's assistant. This number isn't connected to a Plexo account yet.\n\nOpen ${appBaseUrl()}${SOL_SETTINGS_PATH}, tap **Connect WhatsApp**, and send the message it prepares for you — it takes about 10 seconds.`;
}

// ---- storage helpers -----------------------------------------------------------------------------------

async function defaultTier(userId: string): Promise<"BASIC" | "MEDIUM" | "HIGH"> {
  const { data } = await SolPreferences.get({ userId }).go();
  return data?.defaultModelTier ?? "BASIC";
}

async function createConversation(userId: string, organizationId: string): Promise<string> {
  const id = randomUUID();
  const now = new Date().toISOString();
  await SolConversation.create({ id, userId, organizationId, title: "WhatsApp", modelTier: await defaultTier(userId), status: "ACTIVE", messageCount: 0, createdAt: now, updatedAt: now }).go();
  return id;
}

/** Connects `phone` to the account the code was made for, replacing any earlier number or account on either side. */
async function redeemCode(phone: string, code: string): Promise<string> {
  const { data: row } = await WhatsAppLinkCode.get({ code }).go();
  if (!row || new Date(row.expiresAt).getTime() < Date.now()) {
    return `That code has expired or isn't valid. Open ${appBaseUrl()}${SOL_SETTINGS_PATH} and tap **Connect WhatsApp** for a fresh one.`;
  }
  await WhatsAppLinkCode.delete({ code }).go(); // single use

  const { data: previousForUser } = await WhatsAppUserLink.get({ userId: row.userId }).go();
  if (previousForUser && previousForUser.phone !== phone) await WhatsAppLink.delete({ phone: previousForUser.phone }).go();
  const { data: previousForPhone } = await WhatsAppLink.get({ phone }).go();
  if (previousForPhone && previousForPhone.userId !== row.userId) await WhatsAppUserLink.delete({ userId: previousForPhone.userId }).go();

  const conversationId = await createConversation(row.userId, row.organizationId);
  await WhatsAppLink.put({ phone, userId: row.userId, organizationId: row.organizationId, conversationId }).go();
  await WhatsAppUserLink.put({ userId: row.userId, phone }).go();
  // The number is confirmed (the message came from it): keep it on their profile for support. It stays if they disconnect later.
  await savePhoneToProfile(row.userId, phone);
  return "✅ You're connected! Ask me anything about your Plexo account and I'll get it done right here.\n\nTry: _How are my sites doing?_  — or send **HELP** any time.";
}

export async function unlinkPhone(phone: string): Promise<void> {
  const { data } = await WhatsAppLink.get({ phone }).go();
  await WhatsAppLink.delete({ phone }).go();
  if (data) await WhatsAppUserLink.delete({ userId: data.userId }).go();
}

type Pending = { messageId: string; toolName: string; questions?: Array<{ question: string; options?: Array<{ label: string }> }> };

async function findPending(conversationId: string): Promise<Pending | null> {
  const { data: messages } = await SolMessage.query.primary({ conversationId }).go({ pages: "all" });
  const pending = [...messages].reverse().find((m) => m.confirmationState === "PENDING");
  if (!pending || !Array.isArray(pending.content)) return null;
  const block = pending.content.find((b: { type?: string }) => b?.type === "tool_use") as { name?: string; input?: { questions?: Pending["questions"] } } | undefined;
  if (!block?.name) return null;
  return { messageId: pending.id, toolName: block.name, questions: block.name === ASK_USER_QUESTION_TOOL_NAME ? block.input?.questions : undefined };
}

// ---- running a turn -------------------------------------------------------------------------------------

interface TurnOutcome {
  /** Text SOL wrote after its last tool call: the actual answer, without "let me check…" narration. */
  answer: string;
  allText: string;
  prompt: string | null;
  error: string | null;
  outOfCredits: boolean;
}

function collectingEmitter(): { emitter: TurnEmitter; outcome: TurnOutcome; done: Promise<void> } {
  const outcome: TurnOutcome = { answer: "", allText: "", prompt: null, error: null, outOfCredits: false };
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((r) => (resolveDone = r));
  const emitter: TurnEmitter = {
    emit: (frame: StreamFrame) => {
      switch (frame.type) {
        case "token":
          outcome.answer += frame.text;
          outcome.allText += frame.text;
          break;
        case "tool_call_start":
          outcome.answer = "";
          break;
        case "tool_call_awaiting_confirmation":
          outcome.prompt =
            frame.name === ASK_USER_QUESTION_TOOL_NAME
              ? questionPrompt(((frame.args as { questions?: Parameters<typeof questionPrompt>[0] })?.questions ?? []))
              : confirmationPrompt(frame.name, frame.args);
          break;
        case "credit_exhausted":
          outcome.outOfCredits = true;
          break;
        case "error":
          outcome.error = frame.message;
          break;
      }
    },
    end: () => resolveDone(),
  };
  return { emitter, outcome, done };
}

async function reply(phone: string, markdown: string): Promise<void> {
  for (const part of splitForWhatsApp(markdownToWhatsApp(markdown))) await sendWhatsAppText(phone, part);
}

const TRY_AGAIN = "Something went wrong on my side. Please try again in a moment.";

function outOfCreditsText(): string {
  return `You've used up your AI credits, so I can't take that on right now.\n\nTop up: ${appBaseUrl()}${OUT_OF_CREDITS_LINKS.topUpUrl}\nOr use your own AI key: ${appBaseUrl()}${OUT_OF_CREDITS_LINKS.ownKeyUrl}\nOr upgrade for more credits every month: ${appBaseUrl()}${OUT_OF_CREDITS_LINKS.upgradeUrl}\n\nI'll be right back once that's done.`;
}

type Attachments = Extract<PreparedMedia, { ok: true }>["attachments"];

async function runTurn(msg: InboundWhatsAppMessage, link: { userId: string; organizationId: string; conversationId: string }, text: string, attachments: Attachments): Promise<void> {
  const resolved = await resolveUserById(link.userId, { organizationId: link.organizationId, pickWhenAmbiguous: true });
  if (!resolved) {
    await reply(msg.from, "I couldn't find your Plexo account any more. Send **STOP** and reconnect from your dashboard settings.");
    return;
  }

  const pending = await findPending(link.conversationId);
  let prepared;
  if (pending?.questions?.length) {
    prepared = await prepareConfirmTurn(link.conversationId, pending.messageId, resolved, { answers: answersFor(pending.questions, text) });
  } else if (pending) {
    const decision = attachments.length === 0 ? parseDecision(text) : null;
    if (!decision) {
      await reply(msg.from, "I'm waiting on your answer before I go on. Reply **YES** to go ahead or **NO** to cancel.");
      return;
    }
    prepared = await prepareConfirmTurn(link.conversationId, pending.messageId, resolved, { decision });
  } else {
    const { data: conversations } = await SolConversation.query.primary({ userId: link.userId }).go({ pages: "all" });
    const conversation = conversations.find((c) => c.id === link.conversationId);
    prepared = await prepareMessagesTurn(link.conversationId, resolved, { text, attachments, modelTier: conversation?.modelTier ?? (await defaultTier(link.userId)) });
  }

  if (!prepared.ok) {
    const body = prepared.body as { error?: string };
    await reply(msg.from, prepared.status === 402 ? outOfCreditsText() : body?.error && prepared.status < 500 ? body.error : TRY_AGAIN);
    return;
  }

  const { emitter, outcome, done } = collectingEmitter();
  // "typing…" fades after ~25s; keep it alive for as long as SOL is working.
  void sendTypingIndicator(msg.id);
  const typing = setInterval(() => void sendTypingIndicator(msg.id), 20_000);
  try {
    await prepared.run(emitter);
    await done.catch(() => undefined);
  } finally {
    clearInterval(typing);
  }

  if (outcome.outOfCredits) {
    await reply(msg.from, outcome.answer.trim() ? `${outcome.answer.trim()}\n\n${outOfCreditsText()}` : outOfCreditsText());
    return;
  }
  const answer = (outcome.answer.trim() || outcome.allText.trim());
  if (outcome.error && !answer) {
    await reply(msg.from, outcome.error.length < 300 ? outcome.error : TRY_AGAIN);
    return;
  }
  const parts = [answer, outcome.prompt].filter((p): p is string => Boolean(p));
  await reply(msg.from, parts.length ? parts.join("\n\n") : "Done ✅");
}

// ---- entry point ----------------------------------------------------------------------------------------

export async function processInboundMessage(msg: InboundWhatsAppMessage): Promise<void> {
  // Meta retries a webhook it thinks failed; each message id is claimed once.
  try {
    await WhatsAppMessage.create({ messageId: msg.id }).go();
  } catch (err) {
    const e = err as { name?: string; cause?: { name?: string }; code?: string };
    if (e?.name === "ConditionalCheckFailedException" || e?.cause?.name === "ConditionalCheckFailedException" || e?.code === "5003") return;
    throw err;
  }

  try {
    const text = msg.text?.trim() ?? "";
    if (!text && !msg.media) {
      await reply(msg.from, UNSUPPORTED_MEDIA_TEXT);
      return;
    }
    const command = !msg.media ? parseCommand(text) : null;

    if (command?.kind === "link") {
      await reply(msg.from, await redeemCode(msg.from, command.code));
      return;
    }

    const { data: link } = await WhatsAppLink.get({ phone: msg.from }).go();
    if (!link) {
      await reply(msg.from, notLinkedText());
      return;
    }

    if (command?.kind === "help") return await reply(msg.from, HELP_TEXT);
    if (command?.kind === "stop") {
      await unlinkPhone(msg.from);
      return await reply(msg.from, "Disconnected. I won't read or answer messages from this number any more. You can reconnect any time from your Plexo dashboard settings.");
    }
    if (command?.kind === "new") {
      const conversationId = await createConversation(link.userId, link.organizationId);
      await WhatsAppLink.patch({ phone: msg.from }).set({ conversationId }).go();
      return await reply(msg.from, "Fresh start ✨ What would you like to do?");
    }

    let turnText = text;
    let attachments: Attachments = [];
    if (msg.media) {
      // Downloading and (for voice) transcribing takes a few seconds — show "typing…" meanwhile.
      void sendTypingIndicator(msg.id);
      const prepared = await prepareMedia(msg.media, { userId: link.userId, conversationId: link.conversationId, caption: text });
      if (!prepared.ok) return await reply(msg.from, prepared.reply);
      if (prepared.echo) await reply(msg.from, prepared.echo);
      turnText = prepared.text;
      attachments = prepared.attachments;
    }

    await runTurn(msg, link, turnText, attachments);
  } catch (err) {
    console.error("[whatsapp] failed to handle a message:", err);
    await reply(msg.from, TRY_AGAIN).catch(() => undefined);
  }
}
