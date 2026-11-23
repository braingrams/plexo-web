import { describe, expect, it, vi } from "vitest";

const save = vi.fn();
vi.mock("@/lib/sol/feedback", () => ({ saveSolFeedback: (...a: unknown[]) => save(...a) }));

import { parseInboundMessages } from "@/lib/whatsapp/cloudApi";
import { rateLatestAnswer, ratingForReaction } from "@/lib/whatsapp/reactions";

describe("WhatsApp reactions are thumbs up or down", () => {
  it("maps liking and disliking emoji, ignores the rest", () => {
    for (const e of ["👍", "❤️", "❤", "👍🏽", "🙏", "😍", "🔥", "💯", "👏", "🥳", "✅", "😊", "💚", "🎉"]) expect(ratingForReaction(e)).toBe("UP");
    for (const e of ["👎", "😡", "👎🏾", "😤", "🙄", "😞", "💔", "❌", "🤮", "😢"]) expect(ratingForReaction(e)).toBe("DOWN");
    for (const e of ["🌴", "", null, undefined]) expect(ratingForReaction(e)).toBeNull();
  });

  it("parses a reaction message with its emoji (and a removed reaction as none)", () => {
    const payload = (reaction: unknown) => ({ entry: [{ changes: [{ value: { messages: [{ id: "w1", from: "2348050548673", type: "reaction", reaction }] } }] }] });
    expect(parseInboundMessages(payload({ message_id: "x", emoji: "❤️" }))[0]).toMatchObject({ type: "reaction", reactionEmoji: "❤️", text: null });
    expect(parseInboundMessages(payload({ message_id: "x" }))[0].reactionEmoji).toBeNull();
  });

  it("rates the latest answer in the conversation and returns its id", async () => {
    save.mockResolvedValue({ id: "a2", createdAt: "t" });
    expect(await rateLatestAnswer("u", "c1", "UP")).toBe("a2");
    expect(save).toHaveBeenCalledWith({ userId: "u", conversationId: "c1", rating: "UP", source: "whatsapp" });
    save.mockResolvedValue(null);
    expect(await rateLatestAnswer("u", "c1", "UP")).toBeNull();
  });
});
