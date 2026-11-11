import { describe, expect, it } from "vitest";

import { vi } from "vitest";
vi.hoisted(() => {
  for (const t of ["CORE", "LEDGER", "COMMERCE", "CONTENT", "OPS", "IMPORT", "SOL"]) process.env[`PLEXO_${t}_TABLE`] = `test-${t.toLowerCase()}`;
});

vi.mock("@/lib/ai/solChatHandler", () => ({
  prepareMessagesTurn: vi.fn(),
  prepareConfirmTurn: vi.fn(),
  humanizeToolName: (n: string) => n.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
}));
vi.mock("@/lib/ai/solToolSchema", () => ({ ASK_USER_QUESTION_TOOL_NAME: "ask_user_question" }));
vi.mock("@/lib/auth/resolveUserById", () => ({ resolveUserById: vi.fn() }));
vi.mock("@/lib/db/solEntities", () => ({ SolConversation: {}, SolMessage: {}, SolPreferences: {} }));
vi.mock("@/lib/db/whatsappEntities", () => ({ WhatsAppLink: {}, WhatsAppLinkCode: {}, WhatsAppMessage: {}, WhatsAppUserLink: {} }));

import { answersFor, confirmationPrompt, parseCommand, parseDecision, questionPrompt } from "@/lib/whatsapp/inbound";

describe("commands", () => {
  it("recognises link codes, stop, new and help (any case)", () => {
    expect(parseCommand("LINK 483921")).toEqual({ kind: "link", code: "483921" });
    expect(parseCommand("  link 000123 ")).toEqual({ kind: "link", code: "000123" });
    expect(parseCommand("Stop")).toEqual({ kind: "stop" });
    expect(parseCommand("new chat")).toEqual({ kind: "new" });
    expect(parseCommand("help")).toEqual({ kind: "help" });
  });
  it("leaves everything else for SOL", () => {
    expect(parseCommand("link my pages together")).toBeNull();
    expect(parseCommand("link 12345")).toBeNull();
    expect(parseCommand("publish my site")).toBeNull();
  });
});

describe("yes / no", () => {
  it("understands natural confirmations", () => {
    for (const t of ["YES", "yes!", "Go ahead", "ok", "👍"]) expect(parseDecision(t)).toBe("confirmed");
    for (const t of ["no", "Cancel", "don't", "nope."]) expect(parseDecision(t)).toBe("declined");
  });
  it("is null for anything else, so SOL never acts on an unclear answer", () => {
    expect(parseDecision("maybe later")).toBeNull();
    expect(parseDecision("yes but change the title")).toBeNull();
  });
});

describe("prompts and answers", () => {
  it("describes what SOL is about to do, without internal ids", () => {
    const text = confirmationPrompt("delete_landing_page_page", { pageId: "abc123", title: "Spring Sale" });
    expect(text).toContain("Reply **YES**");
    expect(text).toContain("Spring Sale");
    expect(text).not.toContain("abc123");
  });
  it("numbers options and maps a number reply back to its label", () => {
    const questions = [{ question: "Which colour?", options: [{ label: "Blue" }, { label: "Green" }] }];
    expect(questionPrompt(questions)).toContain("1. Blue");
    expect(answersFor(questions, "2")).toEqual([{ question: "Which colour?", answer: "Green" }]);
    expect(answersFor(questions, "teal")).toEqual([{ question: "Which colour?", answer: "teal" }]);
  });
  it("answers several questions from one line each", () => {
    const qs = [{ question: "A?", options: [{ label: "x" }, { label: "y" }] }, { question: "B?" }];
    expect(answersFor(qs, "1\nhello")).toEqual([
      { question: "A?", answer: "x" },
      { question: "B?", answer: "hello" },
    ]);
  });
});
