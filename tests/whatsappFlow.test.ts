import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const dup = () => Object.assign(new Error("exists"), { name: "ConditionalCheckFailedException" });
  const db = {
    links: new Map<string, any>(),
    userLinks: new Map<string, any>(),
    codes: new Map<string, any>(),
    messages: new Set<string>(),
    conversations: [] as any[],
    solMessages: [] as any[],
  };
  const sent: Array<{ to: string; body: string }> = [];
  const state = { prepareMessages: vi.fn(), prepareConfirm: vi.fn() };
  const media = { download: vi.fn(), attachments: [] as any[], transcript: "hello from a voice note" };
  return { dup, db, sent, state, media };
});

vi.mock("@/lib/db/whatsappEntities", () => ({
  WhatsAppLink: {
    get: ({ phone }: any) => ({ go: async () => ({ data: h.db.links.get(phone) ?? null }) }),
    put: (row: any) => ({ go: async () => void h.db.links.set(row.phone, row) }),
    delete: ({ phone }: any) => ({ go: async () => void h.db.links.delete(phone) }),
    patch: ({ phone }: any) => ({ set: (v: any) => ({ go: async () => void h.db.links.set(phone, { ...h.db.links.get(phone), ...v }) }) }),
  },
  WhatsAppUserLink: {
    get: ({ userId }: any) => ({ go: async () => ({ data: h.db.userLinks.get(userId) ?? null }) }),
    put: (row: any) => ({ go: async () => void h.db.userLinks.set(row.userId, row) }),
    delete: ({ userId }: any) => ({ go: async () => void h.db.userLinks.delete(userId) }),
  },
  WhatsAppLinkCode: {
    get: ({ code }: any) => ({ go: async () => ({ data: h.db.codes.get(code) ?? null }) }),
    delete: ({ code }: any) => ({ go: async () => void h.db.codes.delete(code) }),
  },
  WhatsAppMessage: {
    create: ({ messageId }: any) => ({
      go: async () => {
        if (h.db.messages.has(messageId)) throw h.dup();
        h.db.messages.add(messageId);
      },
    }),
  },
}));
vi.mock("@/lib/db/solEntities", () => ({
  SolConversation: {
    create: (row: any) => ({ go: async () => void h.db.conversations.push(row) }),
    query: { primary: () => ({ go: async () => ({ data: h.db.conversations }) }) },
  },
  SolAttachment: { create: (row: any) => ({ go: async () => void h.media.attachments.push(row) }) },
  SolMessage: { query: { primary: () => ({ go: async () => ({ data: h.db.solMessages }) }) } },
  SolPreferences: { get: () => ({ go: async () => ({ data: null }) }) },
}));
vi.mock("@/lib/whatsapp/cloudApi", () => ({
  sendWhatsAppText: async (to: string, body: string) => void h.sent.push({ to, body }),
  sendTypingIndicator: async () => undefined,
  downloadWhatsAppMedia: (...a: unknown[]) => h.media.download(...a),
  MediaTooLargeError: class MediaTooLargeError extends Error {},
}));
vi.mock("@/lib/storage", () => ({ uploadObject: async (path: string) => ({ url: `https://plexo-user-content.s3.us-east-1.amazonaws.com/private/${path}` }) }));
vi.mock("@/lib/ai/transcribeAudio", () => ({
  mediaFormatFor: (t: string) => (t.startsWith("audio/ogg") ? "ogg" : null),
  transcribeAudio: async () => h.media.transcript,
  TranscribeTimeoutError: class TranscribeTimeoutError extends Error {},
}));
vi.mock("@/lib/ai/solChatHandler", () => ({
  prepareMessagesTurn: (...a: unknown[]) => h.state.prepareMessages(...a),
  prepareConfirmTurn: (...a: unknown[]) => h.state.prepareConfirm(...a),
  humanizeToolName: (n: string) => n.replace(/_/g, " "),
}));
vi.mock("@/lib/ai/solToolSchema", () => ({ ASK_USER_QUESTION_TOOL_NAME: "ask_user_question" }));
vi.mock("@/lib/auth/resolveUserById", () => ({ resolveUserById: async (userId: string) => ({ userId, organizationId: "org1" }) }));

import { processInboundMessage } from "@/lib/whatsapp/inbound";

const msg = (id: string, text: string | null, from = "2348011111111", media: any = null) => ({ id, from, type: media ? media.kind : text === null ? "sticker" : "text", text, media, profileName: null });
const lastSent = () => h.sent[h.sent.length - 1]?.body ?? "";

/** A turn that streams `frames` then ends, like the real emitter contract. */
function turn(frames: any[]) {
  return async () => ({
    ok: true as const,
    run: async (emitter: { emit: (f: any) => void; end: () => void }) => {
      for (const f of frames) emitter.emit(f);
      emitter.end();
    },
  });
}

beforeEach(() => {
  h.db.links.clear();
  h.db.userLinks.clear();
  h.db.codes.clear();
  h.db.messages.clear();
  h.db.conversations.length = 0;
  h.db.solMessages.length = 0;
  h.sent.length = 0;
  h.media.attachments.length = 0;
  h.media.transcript = "hello from a voice note";
  h.media.download = vi.fn(async () => ({ bytes: Buffer.from("x"), mimeType: "image/jpeg" }));
  h.state.prepareMessages = vi.fn();
  h.state.prepareConfirm = vi.fn();
});

function linked() {
  h.db.conversations.push({ id: "c1", userId: "u1", modelTier: "BASIC" });
  h.db.links.set("2348011111111", { phone: "2348011111111", userId: "u1", organizationId: "org1", conversationId: "c1" });
  h.db.userLinks.set("u1", { userId: "u1", phone: "2348011111111" });
}

describe("WhatsApp inbound flow", () => {
  it("tells an unlinked number how to connect, in plain words", async () => {
    await processInboundMessage(msg("m1", "hello"));
    expect(lastSent()).toMatch(/isn't connected/);
    expect(lastSent()).toMatch(/Connect WhatsApp/);
  });

  it("connects a number with a valid code, once, and starts a chat for it", async () => {
    h.db.codes.set("123456", { code: "123456", userId: "u1", organizationId: "org1", expiresAt: new Date(Date.now() + 60_000).toISOString() });
    await processInboundMessage(msg("m1", "LINK 123456"));
    expect(lastSent()).toMatch(/You're connected/);
    expect(h.db.links.get("2348011111111")).toMatchObject({ userId: "u1", organizationId: "org1" });
    expect(h.db.userLinks.get("u1")).toMatchObject({ phone: "2348011111111" });
    expect(h.db.codes.has("123456")).toBe(false);
    await processInboundMessage(msg("m2", "LINK 123456"));
    expect(lastSent()).toMatch(/expired or isn't valid/);
  });

  it("rejects an expired code", async () => {
    h.db.codes.set("999999", { code: "999999", userId: "u1", organizationId: "org1", expiresAt: new Date(Date.now() - 1000).toISOString() });
    await processInboundMessage(msg("m1", "LINK 999999"));
    expect(h.db.links.size).toBe(0);
    expect(lastSent()).toMatch(/expired/);
  });

  it("moving a number to another account removes the old pairing", async () => {
    linked();
    h.db.codes.set("222222", { code: "222222", userId: "u2", organizationId: "org2", expiresAt: new Date(Date.now() + 60_000).toISOString() });
    await processInboundMessage(msg("m1", "LINK 222222"));
    expect(h.db.links.get("2348011111111").userId).toBe("u2");
    expect(h.db.userLinks.has("u1")).toBe(false);
  });

  it("ignores a message Meta delivers twice", async () => {
    await processInboundMessage(msg("dup", "hello"));
    await processInboundMessage(msg("dup", "hello"));
    expect(h.sent).toHaveLength(1);
  });

  it("sends SOL's answer — only what it said after its last tool call — as WhatsApp text", async () => {
    linked();
    h.state.prepareMessages = vi.fn(
      turn([
        { type: "token", text: "Let me check. " },
        { type: "tool_call_start", id: "t", name: "list_commerce_orders", label: "x", args: {} },
        { type: "tool_call_result", id: "t", name: "list_commerce_orders", status: "success" },
        { type: "token", text: "You had **12 orders** this week." },
        { type: "message_done", messageId: "m", usage: { inputTokens: 1, outputTokens: 1 } },
      ]),
    );
    await processInboundMessage(msg("m1", "how many orders?"));
    expect(lastSent()).toBe("You had *12 orders* this week.");
    expect(h.state.prepareMessages).toHaveBeenCalledWith("c1", expect.objectContaining({ userId: "u1", organizationId: "org1" }), { text: "how many orders?", attachments: [], modelTier: "BASIC" });
  });

  it("asks before a risky action, then carries it out on YES", async () => {
    linked();
    h.state.prepareMessages = vi.fn(turn([{ type: "tool_call_awaiting_confirmation", id: "t", name: "delete_landing_page_page", args: { title: "Spring Sale" }, messageId: "pm1" }]));
    await processInboundMessage(msg("m1", "delete the spring sale page"));
    expect(lastSent()).toMatch(/Spring Sale/);
    expect(lastSent()).toMatch(/Reply \*YES\*/);

    h.db.solMessages.push({ id: "pm1", confirmationState: "PENDING", content: [{ type: "tool_use", id: "t", name: "delete_landing_page_page", input: {} }] });
    await processInboundMessage(msg("m2", "maybe"));
    expect(lastSent()).toMatch(/waiting on your answer/);
    expect(h.state.prepareConfirm).not.toHaveBeenCalled();

    h.state.prepareConfirm = vi.fn(turn([{ type: "token", text: "Deleted." }]));
    await processInboundMessage(msg("m3", "YES"));
    expect(h.state.prepareConfirm).toHaveBeenCalledWith("c1", "pm1", expect.anything(), { decision: "confirmed" });
    expect(lastSent()).toBe("Deleted.");
  });

  it("explains out-of-credit in plain language", async () => {
    linked();
    h.state.prepareMessages = vi.fn(async () => ({ ok: false as const, status: 402, body: { error: "insufficient_credits" } }));
    await processInboundMessage(msg("m1", "build me a site"));
    expect(lastSent()).toMatch(/used up your AI credits/);
    expect(lastSent()).not.toMatch(/insufficient_credits/);
  });

  it("STOP disconnects, NEW starts a fresh chat, and photos get a kind answer", async () => {
    linked();
    await processInboundMessage(msg("m1", "NEW"));
    expect(h.db.links.get("2348011111111").conversationId).not.toBe("c1");
    await processInboundMessage(msg("m2", null));
    expect(lastSent()).toMatch(/voice notes/);
    await processInboundMessage(msg("m3", "stop"));
    expect(h.db.links.size).toBe(0);
    expect(h.db.userLinks.size).toBe(0);
  });

  it("reads a photo with its caption: saved privately, handed to SOL as an image", async () => {
    linked();
    h.state.prepareMessages = vi.fn(turn([{ type: "token", text: "Done — banner updated." }]));
    await processInboundMessage(msg("p1", "make the banner match this", "2348011111111", { kind: "image", id: "mid1", mimeType: "image/jpeg", filename: null }));
    const [, , body] = h.state.prepareMessages.mock.calls[0];
    expect(body.text).toBe("make the banner match this");
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0]).toMatchObject({ type: "image", filename: "whatsapp-photo.jpg" });
    expect(body.attachments[0].url).toContain("/private/sol-attachments/u1/");
    expect(h.media.attachments[0]).toMatchObject({ userId: "u1", conversationId: "c1", contentType: "image/jpeg" });
    expect(lastSent()).toBe("Done — banner updated.");
  });

  it("opens a PDF the same way, and a photo with no caption still reaches SOL", async () => {
    linked();
    h.state.prepareMessages = vi.fn(turn([{ type: "token", text: "Got it." }]));
    await processInboundMessage(msg("p2", null, "2348011111111", { kind: "document", id: "mid2", mimeType: "application/pdf", filename: "Menu 2026.pdf" }));
    const [, , body] = h.state.prepareMessages.mock.calls[0];
    expect(body.text).toBe("");
    expect(body.attachments[0]).toMatchObject({ type: "pdf", filename: "Menu 2026.pdf" });
    expect(body.attachments[0].url).toContain("Menu-2026.pdf");
  });

  it("turns a voice note into text, shows what it heard, then answers", async () => {
    linked();
    h.state.prepareMessages = vi.fn(turn([{ type: "token", text: "On it." }]));
    await processInboundMessage(msg("v1", null, "2348011111111", { kind: "audio", id: "mid3", mimeType: "audio/ogg; codecs=opus", filename: null }));
    expect(h.sent.map((m) => m.body)).toEqual(["🎙️ _“hello from a voice note”_", "On it."]);
    expect(h.state.prepareMessages.mock.calls[0][2]).toMatchObject({ text: "hello from a voice note", attachments: [] });
  });

  it("says so kindly when a voice note has no words in it", async () => {
    linked();
    h.media.transcript = "";
    await processInboundMessage(msg("v2", null, "2348011111111", { kind: "audio", id: "mid4", mimeType: "audio/ogg", filename: null }));
    expect(lastSent()).toMatch(/couldn't make out any words/);
    expect(h.state.prepareMessages).not.toHaveBeenCalled();
  });

  it("never downloads a stranger's files, and declines file types it can't open", async () => {
    await processInboundMessage(msg("x1", null, "2349999999999", { kind: "image", id: "m", mimeType: "image/jpeg", filename: null }));
    expect(lastSent()).toMatch(/isn't connected/);
    expect(h.media.download).not.toHaveBeenCalled();

    linked();
    await processInboundMessage(msg("x2", null, "2348011111111", { kind: "document", id: "m", mimeType: "application/zip", filename: "a.zip" }));
    expect(lastSent()).toMatch(/can't open that kind of file/);
    expect(h.state.prepareMessages).not.toHaveBeenCalled();
  });

  it("a photo can't answer a pending YES/NO question", async () => {
    linked();
    h.db.solMessages.push({ id: "pm9", confirmationState: "PENDING", content: [{ type: "tool_use", id: "t", name: "delete_landing_page_page", input: {} }] });
    await processInboundMessage(msg("y1", null, "2348011111111", { kind: "image", id: "m", mimeType: "image/png", filename: null }));
    expect(lastSent()).toMatch(/waiting on your answer/);
    expect(h.state.prepareConfirm).not.toHaveBeenCalled();
  });
});
