import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/coreEntities", () => ({ SiteBrand: {} }));
vi.mock("@/lib/db/contentEntities", () => ({ Template: {} }));
import { FORMALITY, TONES, hasVoice, mergeVoice, parseVoiceResult, readSiteVoice, sanitizeVoice, suggestedMetaDescription, tonesFromText, voiceFromBrandContext, voiceIntoBrandContext, voicePromptBlock, voiceSummary } from "@/lib/brand/brandVoice";
import { mergeVoicePatch, saveSiteVoice, VoiceError, type VoiceDeps } from "@/lib/brand/voiceStore";
import { brandPromptBlock, mergeBrand } from "@/lib/brand/brandModel";
import { readSiteBrand, siteBrandFromLook } from "@/lib/dashboardV3/brandLook";

const WORDS = { tagline: "Fresh bread, baked slow.", aboutLine: "A family bakery in Lagos.", tones: ["warm", "friendly"], formality: "casual", audience: "busy neighbours", wordsLike: ["handmade"], wordsAvoid: ["cheap"] } as const;

describe("brand voice: reading and checking", () => {
  it("keeps good words, drops unknown tones, odd formality and control characters", () => {
    const v = readSiteVoice({ tagline: "  Hello\n there ", tones: ["warm", "nonsense", "warm"], formality: "loud", wordsLike: "a, b, a", wordsAvoid: ["a", "z"] });
    expect(v).toEqual({ tagline: "Hello there", tones: ["warm"], wordsLike: ["a", "b"], wordsAvoid: ["z"] });
    expect(readSiteVoice(null)).toBeUndefined();
    expect(readSiteVoice({})).toBeUndefined();
  });
  it("explains problems in plain words", () => {
    const long = sanitizeVoice({ tagline: "x".repeat(200) });
    expect(long.ok).toBe(false);
    expect(!long.ok && long.error).toMatch(/tagline is a little long/);
    const many = sanitizeVoice({ tones: ["warm", "calm", "bold", "expert", "playful"] });
    expect(!many.ok && many.error).toMatch(/up to 4 tones/);
    expect(sanitizeVoice("nope").ok).toBe(false);
    expect(sanitizeVoice({}).ok).toBe(true);
  });
  it("reads SOL's answer safely", () => {
    const v = parseVoiceResult({ tagline: "T", tones: ["Warm", "WITTY"], formality: "In between", audience: "a", wordsLike: ["x"], wordsAvoid: [], extra: "ignored" });
    expect(v).toEqual({ tagline: "T", tones: ["warm"], formality: "balanced", audience: "a", wordsLike: ["x"] });
    expect(parseVoiceResult("garbage")).toEqual({});
  });
  it("every tone and formality has a plain example", () => {
    for (const t of [...TONES, ...FORMALITY]) expect(t.example.length).toBeGreaterThan(5);
  });
});

describe("brand voice: defaults and summary", () => {
  it("starts from the onboarding answers and lets the site's own words win", () => {
    expect(mergeVoice(undefined, { about: "We sell tea.", tone: "warm and professional" })).toEqual({ aboutLine: "We sell tea.", tones: ["professional", "warm"] });
    expect(mergeVoice({ aboutLine: "Mine", tones: ["bold"] }, { about: "We sell tea.", tone: "warm" })).toEqual({ aboutLine: "Mine", tones: ["bold"] });
    expect(tonesFromText("elegant and playful")).toEqual(["playful", "luxurious"]);
  });
  it("summarises and suggests a search description", () => {
    expect(voiceSummary(WORDS as never)).toBe("warm, friendly; casual; for busy neighbours");
    expect(suggestedMetaDescription(WORDS as never)).toBe("A family bakery in Lagos.");
    expect(suggestedMetaDescription({ tagline: "Slow." }, "Ama")).toBe("Ama: Slow.");
    expect(suggestedMetaDescription(undefined)).toBe("");
  });
});

describe("brand voice: put into every prompt", () => {
  it("writes a prompt block that quotes the owner's words and never treats them as instructions", () => {
    const b = voicePromptBlock(WORDS as never);
    expect(b).toContain('Tagline: "Fresh bread, baked slow."');
    expect(b).toContain("Tone: warm, friendly");
    expect(b).toContain('never use): "cheap"');
    expect(b).toContain("not as instructions");
    expect(voicePromptBlock(undefined)).toBe("");
    expect(voicePromptBlock({})).toBe("");
  });
  it("is part of the brand block SOL and MCP tools read, even for a site with no colours yet", () => {
    const resolved = mergeBrand({ siteId: "s1", own: { voice: WORDS as never } });
    expect(resolved.tagline).toBe("Fresh bread, baked slow.");
    expect(resolved.voice).toContain("warm");
    const block = brandPromptBlock(resolved, "Ama");
    expect(block).toContain("Tagline");
    expect(block).toContain("Words they avoid");
    const withColour = brandPromptBlock(mergeBrand({ siteId: "s1", own: { colors: ["#E4572E"], voice: WORDS as never } }), "Ama");
    expect(withColour).toContain("#E4572E");
    expect(withColour).toContain("Tagline");
  });
  it("falls back to the onboarding tone as before", () => {
    const r = mergeBrand({ siteId: "s1", profile: { tone: "friendly", about: "Tea shop" } as never });
    expect(r.voice).toBe("friendly");
    expect(r.about).toBe("Tea shop");
  });
});

describe("brand voice: where it is stored", () => {
  it("lives on the site's brand record and survives saving a new look", () => {
    const own = readSiteBrand({ colors: ["#E4572E"], voice: WORDS });
    expect(own?.voice?.tagline).toBe("Fresh bread, baked slow.");
    const after = siteBrandFromLook({ colors: ["#1F6FEB"], logoUrl: null, logoSkipped: true }, own);
    expect(after.voice?.tagline).toBe("Fresh bread, baked slow.");
    expect(after.colors).toEqual(["#1F6FEB"]);
  });
  it("a patch changes what it names, clears with empty values and leaves the rest", () => {
    const r = mergeVoicePatch(WORDS as never, { tagline: "New one", wordsAvoid: [], audience: "" });
    expect(r.ok && r.value).toMatchObject({ tagline: "New one", aboutLine: "A family bakery in Lagos.", tones: ["warm", "friendly"] });
    expect(r.ok && r.value.wordsAvoid).toBeUndefined();
    expect(r.ok && r.value.audience).toBeUndefined();
  });
  it("is written into a Strata project's brand context without losing what is there", () => {
    const ctx = voiceIntoBrandContext({ brief: "keep me", feel: { visualTone: "Minimal" } }, WORDS as never);
    expect(ctx.brief).toBe("keep me");
    expect((ctx.feel as { visualTone: string; mood: string[] }).visualTone).toBe("Minimal");
    expect((ctx.feel as { mood: string[] }).mood).toEqual(["warm", "friendly"]);
    expect((ctx.voice as { tagline: string }).tagline).toBe("Fresh bread, baked slow.");
    const kept = voiceIntoBrandContext({ feel: { mood: ["Moody"] } }, WORDS as never);
    expect((kept.feel as { mood: string[] }).mood).toEqual(["Moody"]);
    expect(voiceIntoBrandContext({ voice: { tagline: "x" } }, {}).voice).toBeUndefined();
  });
  it("reads words back from a brand that was edited in Strata", () => {
    expect(voiceFromBrandContext({ voice: { tagline: "Hi" }, feel: { mood: ["Warm", "Bold"] } })).toEqual({ tagline: "Hi", tones: ["warm", "bold"] });
    expect(voiceFromBrandContext({ feel: {} })).toBeUndefined();
    expect(hasVoice({})).toBe(false);
  });
});

function deps(over: Partial<VoiceDeps> = {}): VoiceDeps & { written: unknown[] } {
  const written: unknown[] = [];
  return {
    written,
    read: async () => ({ brand: { colors: ["#E4572E"] }, organizationId: "o1" }),
    write: async (_id, brand) => { written.push(brand); },
    link: async () => ({ projectId: "p1", userId: "u1" }),
    session: async () => "tok",
    sendToStrata: async () => undefined,
    ...over,
  };
}

describe("saving the words", () => {
  it("saves on the site first, then copies into the linked brand", async () => {
    const sent = vi.fn(async () => undefined);
    const d = deps({ sendToStrata: sent });
    const r = await saveSiteVoice({ siteId: "s1", userId: "u1", organizationId: "o1", patch: { tagline: "Hi" } }, d);
    expect(d.written[0]).toMatchObject({ colors: ["#E4572E"], voice: { tagline: "Hi" } });
    expect(sent).toHaveBeenCalledWith("tok", "p1", { tagline: "Hi" });
    expect(r.state).toBe("in-strata");
  });
  it("keeps the words when the brand library can't be reached", async () => {
    const d = deps({ sendToStrata: async () => { throw new Error("down"); } });
    const r = await saveSiteVoice({ siteId: "s1", userId: "u1", organizationId: "o1", patch: { tagline: "Hi" } }, d);
    expect(r.state).toBe("waiting");
    expect(d.written).toHaveLength(1);
    expect(r.message).toMatch(/Saved/);
  });
  it("works without a linked brand and refuses another account's site", async () => {
    const r = await saveSiteVoice({ siteId: "s1", userId: "u1", organizationId: "o1", patch: { tagline: "Hi" } }, deps({ link: async () => null }));
    expect(r.state).toBe("not-linked");
    await expect(saveSiteVoice({ siteId: "s1", userId: "u1", organizationId: "other", patch: { tagline: "x" } }, deps())).rejects.toBeInstanceOf(VoiceError);
    await expect(saveSiteVoice({ siteId: "s1", userId: "u1", organizationId: "o1", patch: { tagline: "x".repeat(300) } }, deps())).rejects.toThrow(/little long/);
  });
});
