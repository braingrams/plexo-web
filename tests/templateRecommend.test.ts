import { describe, expect, it } from "vitest";
import { MAX_PICKS, completePicks, parsePicks, rankByKeywords, type Candidate } from "@/lib/marketplace/recommend";

const items: Candidate[] = [
  { id: "bakery", name: "Sweet Crumbs", category: "Food", description: "A warm bakery and cake shop with online orders" },
  { id: "clinic", name: "CareFirst", category: "Health", description: "Clinic with booking and trust sections" },
  { id: "church", name: "Grace", category: "Community", description: "Church with events and sermons" },
  { id: "folio", name: "Folio", category: "Portfolio", description: "Designer portfolio" },
  { id: "saas", name: "Launchpad", category: "Software", description: "App landing page with pricing" },
  { id: "event", name: "Gather", category: "Events", description: "Conference and events" },
  { id: "blog", name: "Pen", category: "Blog", description: "Writer blog" },
];

describe("template matching", () => {
  it("word match puts the fitting template first and explains why", () => {
    const [top] = rankByKeywords("a bakery in Lagos that takes cake orders", items);
    expect(top.id).toBe("bakery");
    expect(top.reason).toMatch(/bakery|cake|orders/);
  });
  it("keeps popularity order when nothing matches", () => {
    expect(rankByKeywords("zzz qqq", items)[0].id).toBe("bakery");
  });
  it("reads the model's reply defensively: unknown ids, repeats and prose around the JSON are dropped", () => {
    const ids = new Set(items.map((t) => t.id));
    const reply = 'Sure! [{"id":"clinic","reason":"Bookings for patients"},{"id":"nope","reason":"x"},{"id":"clinic","reason":"dup"},{"id":"church"}]';
    const picks = parsePicks(reply, ids);
    expect(picks.map((p) => p.id)).toEqual(["clinic", "church"]);
    expect(picks[0].reason).toBe("Bookings for patients");
    expect(picks[1].reason.length).toBeGreaterThan(0);
  });
  it("unusable replies give nothing, and the list is topped up from the word match", () => {
    expect(parsePicks("I cannot help", new Set(["a"]))).toEqual([]);
    expect(parsePicks("[not json", new Set(["a"]))).toEqual([]);
    const full = completePicks([{ id: "clinic", reason: "r" }], "church events", items);
    expect(full[0].id).toBe("clinic");
    expect(full.length).toBe(MAX_PICKS);
    expect(new Set(full.map((p) => p.id)).size).toBe(full.length);
  });
});

import { parseUnderstood, buildUnderstandPrompt, INDUSTRIES, STYLES } from "@/lib/onboarding/understandWords";
import { parseCreateRequest, profileFor } from "@/lib/dashboardV3/newSite";

describe("understanding what someone wants their website to look like", () => {
  it("accepts only the allowed words from the model", () => {
    expect(parseUnderstood('Sure {"industry":"Restaurant","style":"warm"}')).toEqual({ industry: "restaurant", style: "warm" });
    expect(parseUnderstood('{"industry":"spaceships","style":"warm"}')).toBeNull();
    expect(parseUnderstood("no json")).toBeNull();
  });
  it("tells the model exactly which words it may use", () => {
    const prompt = buildUnderstandPrompt("a bakery in Lagos", "store");
    for (const w of [...INDUSTRIES, ...STYLES]) expect(prompt).toContain(w);
  });
  it("carries the description and what SOL understood into the site's profile, and rejects made-up words", () => {
    const ok = parseCreateRequest({ goal: "store", name: "Ama's", about: "warm bakery", industry: "restaurant", style: "warm" });
    expect(ok.ok && ok.value).toMatchObject({ about: "warm bakery", industry: "restaurant", style: "warm" });
    const bad = parseCreateRequest({ goal: "store", name: "Ama's", industry: "nonsense", style: "x" });
    expect(bad.ok && bad.value.industry).toBeUndefined();
    const p = profileFor("store", "Ama's", undefined, { about: "warm bakery", industry: "restaurant", tone: "warm" });
    expect(p.brand).toMatchObject({ name: "Ama's", about: "warm bakery", industry: "restaurant", tone: "warm" });
  });
});
