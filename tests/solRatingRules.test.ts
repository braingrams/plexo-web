import { describe, expect, it, vi } from "vitest";

import { ratingForEmojiMessage } from "@/lib/sol/ratingEmoji";
import { messageToRate } from "@/app/dashboard/_v3/sol/ratingRules";
import type { SolMessage } from "@/app/dashboard/sol/_components/types";

const text = (t: string) => ({ type: "text", text: t });
const tool = (name: string, status?: string) => ({ type: "tool_use", id: "t", name, input: {}, ...(status ? { status } : {}) });
const msg = (id: string, role: "user" | "assistant", content: unknown[], extra: Partial<SolMessage> = {}) => ({ id, role, content, createdAt: "2026-11-23T10:00:00Z", ...extra }) as SolMessage;

describe("a message that is only a rating emoji is a rating", () => {
  it("counts love and thumbs as up, thumbs down as down", () => {
    for (const t of ["❤️", "❤", "👍", "👍👍", " ❤️ ", "🙏🏽"]) expect(ratingForEmojiMessage(t)).toBe("UP");
    for (const t of ["👎", "😡"]) expect(ratingForEmojiMessage(t)).toBe("DOWN");
  });
  it("leaves real messages alone", () => {
    for (const t of ["thanks ❤️", "ok", "👍👎", "🌴", "", null, "1"]) expect(ratingForEmojiMessage(t as string)).toBeNull();
  });
});

describe("when SOL asks how it went", () => {
  const user = msg("u", "user", [text("build me a page")]);
  it("after finished work: a tool was used and the answer is done", () => {
    const m = [user, msg("a", "assistant", [tool("page_create_from_template"), text("Done, it's live.")])];
    expect(messageToRate(m, { streaming: false, waiting: false })?.id).toBe("a");
  });
  it("not for a plain chat reply", () => {
    expect(messageToRate([user, msg("a", "assistant", [text("Sure.")])], { streaming: false, waiting: false })).toBeNull();
  });
  it("not while working, waiting on the owner, or when a question was the only tool", () => {
    const done = [user, msg("a", "assistant", [tool("get_analytics"), text("Here you go.")])];
    expect(messageToRate(done, { streaming: true, waiting: false })).toBeNull();
    expect(messageToRate(done, { streaming: false, waiting: true })).toBeNull();
    expect(messageToRate([user, msg("a", "assistant", [tool("ask_user_question"), text("Which one?")])], { streaming: false, waiting: false })).toBeNull();
    expect(messageToRate([user, msg("a", "assistant", [tool("page_publish", "awaiting_confirmation"), text("Publish?")])], { streaming: false, waiting: false })).toBeNull();
  });
  it("not once the answer has been rated", () => {
    expect(messageToRate([user, msg("a", "assistant", [tool("get_analytics"), text("Here.")], { feedback: "UP" })], { streaming: false, waiting: false })).toBeNull();
  });
});
