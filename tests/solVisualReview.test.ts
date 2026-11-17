import { describe, expect, it } from "vitest";
import { VISUAL_REVIEW_PROMPT, captureForReview, isLooksGood, newVisualState, noteTouchedPage, visualReviewContent, visualReviewEnabled } from "@/lib/ai/solVisualReview";
import { createFinalHold } from "@/lib/ai/solFinalHold";
import { modelSupportsImages } from "@/lib/ai/modelRegistry";
import { screenshotDraftPage } from "@/lib/projects/draftScreenshot";

describe("visual review helpers", () => {
  it("the prompt asks for a visual critique and one fix, and never to tell the owner", () => {
    for (const w of ["desktop and phone screenshots", "overlapping or cramped", "unreadable text", "empty or broken image", "weak hierarchy", "off-brand colours", "one more page_edit", "LOOKS_GOOD", "Never mention this check"]) expect(VISUAL_REVIEW_PROMPT).toContain(w);
  });
  it("only the first touched page is the target", () => {
    const s = newVisualState();
    noteTouchedPage(s, ["a", "b"]);
    noteTouchedPage(s, ["c"]);
    expect(s.target).toBe("a");
  });
  it("recognises the all-clear reply", () => {
    expect(isLooksGood("LOOKS_GOOD")).toBe(true);
    expect(isLooksGood(" looks_good. ")).toBe(true);
    expect(isLooksGood("I fixed the hero.")).toBe(false);
  });
  it("is skipped when switched off, or when the model cannot take images", () => {
    expect(visualReviewEnabled("anthropic_claude", "MEDIUM", {})).toBe(true);
    expect(visualReviewEnabled("anthropic_claude", "MEDIUM", { SOL_VISUAL_REVIEW: "off" })).toBe(false);
    expect(modelSupportsImages("bedrock_claude", "HIGH")).toBe(true);
  });
  it("sends images as image content with the instruction last", () => {
    const blocks = visualReviewContent([{ device: "phone", kind: "top", imageUrl: "https://x/y.jpg" }]) as any[];
    expect(blocks.some((b) => b.type === "image" && b.source.url === "https://x/y.jpg")).toBe(true);
    expect(blocks.at(-1).text).toBe(VISUAL_REVIEW_PROMPT);
  });
  it("captureForReview fails open on errors, timeouts and unknown pages", async () => {
    const ok = { resolveTarget: async (id: string) => ({ templateId: id, pageId: null }), shoot: async () => [{ device: "desktop" as const, kind: "top" as const, imageUrl: "u" }] };
    expect(await captureForReview("p", ok)).toHaveLength(1);
    expect(await captureForReview("p", { ...ok, shoot: async () => { throw new Error("x"); } })).toBeNull();
    expect(await captureForReview("p", { ...ok, shoot: () => new Promise(() => {}), timeoutMs: 10 })).toBeNull();
    expect(await captureForReview("p", { ...ok, resolveTarget: async () => null })).toBeNull();
  });
});

describe("the final-text hold", () => {
  it("passes text straight through when nothing is held", () => {
    const out: string[] = [];
    createFinalHold((d) => out.push(d), () => false).onTextDelta("hi");
    expect(out).toEqual(["hi"]);
  });
  it("buffers, then releases unchanged, discards, or hands it back", () => {
    const out: string[] = [];
    let started = 0;
    const h = createFinalHold((d) => out.push(d), () => true, () => started++);
    h.onTextDelta("a");
    h.onTextDelta("b");
    expect(out).toEqual([]);
    expect(started).toBe(1);
    h.release();
    expect(out.join("")).toBe("ab");
    h.onTextDelta("c"); // after release the rest of the round streams
    expect(out.join("")).toBe("abc");
    const h2 = createFinalHold((d) => out.push(d), () => true);
    h2.onTextDelta("zzz");
    h2.discard();
    h2.release();
    expect(out.join("")).toBe("abc");
    const h3 = createFinalHold((d) => out.push(d), () => true);
    h3.onTextDelta("kept");
    expect(h3.take()).toBe("kept");
    expect(out.join("")).toBe("abc");
  });
  it("text written just before a tool call is released at once", () => {
    const out: string[] = [];
    const h = createFinalHold((d) => out.push(d), () => true);
    h.onTextDelta("Working on it. ");
    h.onToolStart();
    expect(out.join("")).toBe("Working on it. ");
  });
});

describe("draft screenshots", () => {
  it("opens one signed address and takes desktop top + full page and phone top", async () => {
    const calls: Array<{ url: string; viewport: string; fullPage?: boolean }> = [];
    const shots = await screenshotDraftPage({ templateId: "root1", pageId: "pg2", device: "both", userId: "u1" }, {
      origin: "https://app.example.com",
      secret: "s",
      shoot: async (url, o) => (calls.push({ url, viewport: o.viewport, fullPage: o.fullPage }), { imageUrl: `img-${o.viewport}-${o.fullPage ? "full" : "top"}` }),
    });
    expect(shots.map((s) => `${s.device}:${s.kind}`).sort()).toEqual(["desktop:full", "desktop:top", "phone:top"]);
    expect(calls).toHaveLength(3);
    const u = new URL(calls[0].url);
    expect(u.origin + u.pathname).toBe("https://app.example.com/api/v1/templates/root1/draft-preview");
    expect(u.searchParams.get("page")).toBe("pg2");
    expect(u.searchParams.get("shot")).toBe("1");
    expect(u.searchParams.get("sig")).toBeTruthy();
  });
  it("refuses a deployment with no public https address", async () => {
    delete process.env.PLEXO_SELF_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    await expect(screenshotDraftPage({ templateId: "r", device: "phone", userId: "u" }, { shoot: async () => ({ imageUrl: "x" }) })).rejects.toThrow(/public/);
  });
});
