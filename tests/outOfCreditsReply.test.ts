import { describe, expect, it } from "vitest";
import { aiErrorMessage, isOutOfCreditsReply } from "@/lib/ai/requestErrors";
// Same wording as SOL_NOT_ENOUGH_CREDITS in lib/ai/solEngine.ts (not imported: that file needs the database settings).
const SOL_NOT_ENOUGH_CREDITS = "SOL needs more credits to do this. Top up in Settings → Subscription, or add your own AI key in Settings → AI.";

describe("isOutOfCreditsReply", () => {
  it("recognises every out-of-credits wording", () => {
    expect(isOutOfCreditsReply(SOL_NOT_ENOUGH_CREDITS)).toBe(true);
    expect(isOutOfCreditsReply(aiErrorMessage(402, null))).toBe(true);
  });
  it("ignores ordinary replies", () => expect(isOutOfCreditsReply("I changed the headline.")).toBe(false));
});
