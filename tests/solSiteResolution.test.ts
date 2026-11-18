import { describe, expect, it } from "vitest";
import { NEW_SITE_LABEL, SITE_QUESTION, newOrAddQuestion, pickedFromAnswers, resolveSite, siteLabels, type OwnerSite } from "@/lib/ai/solSiteResolution";
import { briefFromConversation, discoveryPrompt } from "@/lib/ai/solDiscovery";
import { readCurrentSiteCookie } from "@/lib/dashboardV3/siteCookie";

const bakery: OwnerSite = { id: "site-bakery-1", name: "Crumb & Co", updatedAt: "2026-11-10", brand: { colors: ["#C2410C"], logoUrl: "https://cdn.example/crumb.png" } };
const gym: OwnerSite = { id: "site-gym-0001", name: "Iron Haven Gym", updatedAt: "2026-11-16", brand: { colors: ["#111827"], noLogo: true } };
const base = { touchesExisting: true, isNewBuild: false };
const user = (text: string) => ({ role: "user" as const, content: [{ type: "text", text }] });

describe("resolveSite: explicit > conversation > picked > single > ask", () => {
  it("none: a new site", () => expect(resolveSite({ ...base, sites: [] })).toEqual({ kind: "none" }));
  it("exactly one site: uses it and says so", () => {
    const r = resolveSite({ ...base, sites: [bakery] });
    expect(r).toMatchObject({ kind: "use", via: "single", announce: true });
  });
  it("two sites and nothing chosen: asks, never takes the latest", () => {
    const r = resolveSite({ ...base, sites: [bakery, gym] });
    expect(r.kind).toBe("ask-which");
    if (r.kind === "ask-which") expect(r.options.map((o) => o.label)).toEqual(["Iron Haven Gym", "Crumb & Co", NEW_SITE_LABEL]);
  });
  it("the cookie is a hint: it orders the choices but never decides", () => {
    const r = resolveSite({ ...base, sites: [bakery, gym], signal: { hintSiteId: bakery.id } });
    expect(r.kind).toBe("ask-which");
    if (r.kind === "ask-which") expect(r.options[0].label).toBe("Crumb & Co");
  });
  it("an explicit choice wins over the binding and the hint", () => {
    const r = resolveSite({ ...base, sites: [bakery, gym], signal: { explicitSiteId: gym.id, boundSiteId: bakery.id, hintSiteId: bakery.id } });
    expect(r).toMatchObject({ kind: "use", via: "explicit" });
    expect((r as { site: OwnerSite }).site.id).toBe(gym.id);
  });
  it("the conversation's binding stops later turns asking (and is not re-announced)", () => {
    expect(resolveSite({ ...base, sites: [bakery, gym], signal: { boundSiteId: bakery.id } })).toMatchObject({ kind: "use", via: "bound", announce: false });
  });
  it("an id that isn't one of the owner's sites is ignored", () => {
    expect(resolveSite({ ...base, sites: [bakery, gym], signal: { explicitSiteId: "someone-elses" } }).kind).toBe("ask-which");
  });
  it("a pick made in this conversation is remembered from the answers", () => {
    const answers = [{ question: SITE_QUESTION, answer: "Crumb & Co" }];
    expect(resolveSite({ ...base, sites: [bakery, gym], answers })).toMatchObject({ kind: "use", via: "picked" });
    expect(resolveSite({ ...base, sites: [bakery, gym], answers: [{ question: SITE_QUESTION, answer: NEW_SITE_LABEL }] })).toEqual({ kind: "new", reason: "picked-new" });
    expect(resolveSite({ ...base, sites: [bakery, gym], answers: [{ question: SITE_QUESTION, answer: "the other thing" }] }).kind).toBe("unresolved");
  });
  it("a new build for a business named in the message, with no site chosen, is simply new", () => {
    expect(resolveSite({ sites: [bakery, gym], touchesExisting: false, isNewBuild: true, namedBusiness: "Glow Studio" })).toEqual({ kind: "new", reason: "named-other-business" });
  });
  it("a chosen site + a new build for a different business: asks new or add; same business: just uses it", () => {
    const r = resolveSite({ sites: [bakery], touchesExisting: false, isNewBuild: true, namedBusiness: "Glow Studio" });
    expect(r).toEqual({ kind: "ask-new-or-add", site: bakery });
    expect(resolveSite({ sites: [bakery], touchesExisting: false, isNewBuild: true, namedBusiness: "Crumb and Co" }).kind).toBe("use");
    expect(resolveSite({ sites: [bakery], touchesExisting: false, isNewBuild: true, namedBusiness: "Crumb & Co" }).kind).toBe("use");
  });
  it("two sites with the same name get distinct labels", () => {
    const labels = [...siteLabels([{ id: "a1", name: "Shop", updatedAt: "2" }, { id: "b1", name: "Shop", updatedAt: "1" }]).values()];
    expect(labels).toEqual(["Shop", "Shop (2)"]);
    expect(pickedFromAnswers([{ question: SITE_QUESTION, answer: "Shop (2)" }], [{ id: "a1", name: "Shop", updatedAt: "2" }, { id: "b1", name: "Shop", updatedAt: "1" }])).toEqual({ siteId: "b1" });
  });
  it("reads the new-or-add answer", () => {
    expect(pickedFromAnswers([{ question: newOrAddQuestion("Crumb & Co"), answer: "Add to Crumb & Co" }], [bakery])).toEqual({ siteId: bakery.id });
  });
});

describe("the chat asks, and the brief never takes brand from an unselected site", () => {
  const profile = { sites: [bakery, gym] };
  it("an edit with two sites and none chosen: the ONLY first action is the site question", () => {
    const { plan, resolution, brief } = briefFromConversation([user("change the colours on my site to blue")], profile);
    expect(resolution.kind).toBe("ask-which");
    expect(plan.mode).toBe("ask");
    expect(plan.questions.map((q) => q.question)).toEqual([SITE_QUESTION]);
    expect(plan.questions[0].options.map((o) => o.label)).toContain(NEW_SITE_LABEL);
    // no brand from either site
    expect(brief.logo.status).toBe("missing");
    expect(brief.colors.value ?? []).not.toContain("#C2410C");
    expect(brief.colors.value ?? []).not.toContain("#111827");
    const text = discoveryPrompt(brief, plan, resolution);
    expect(text).toContain("Do not guess and do not use the most recent one");
    expect(text).toContain(SITE_QUESTION);
    expect(text).not.toContain("#C2410C");
    expect(text).not.toContain("#111827");
  });
  it("a thin new build with two sites folds the site question into the intake card, first", () => {
    const { plan, brief } = briefFromConversation([user("build me a landing page")], profile);
    expect(plan.questions[0].question).toBe(SITE_QUESTION);
    expect(plan.questions.length).toBe(7);
    expect(brief.colors.status).toBe("missing");
  });
  it("after the owner picks, it uses only that site's brand and doesn't ask again", () => {
    const history = [
      user("change the colours on my site"),
      { role: "assistant" as const, content: [{ type: "tool_use", id: "t1", name: "ask_user_question", input: {} }] },
      { role: "user" as const, content: [{ type: "tool_result", tool_use_id: "t1", content: `Q: ${SITE_QUESTION}\nA: Iron Haven Gym` }] },
    ];
    const { resolution, brief, plan } = briefFromConversation(history, profile);
    expect(resolution).toMatchObject({ kind: "use", via: "picked" });
    expect(brief.colors.value).toEqual(["#111827"]);
    expect(brief.name.value).toBe("Iron Haven Gym");
    expect(plan.questions).toEqual([]);
    expect(discoveryPrompt(brief, plan, resolution)).toContain("I'll work on Iron Haven Gym.");
  });
  it("one site: used and announced; brand comes from it", () => {
    const { resolution, brief } = briefFromConversation([user("change the headline on my site")], { sites: [bakery] });
    expect(resolution).toMatchObject({ kind: "use", via: "single" });
    expect(brief.colors.value).toEqual(["#C2410C"]);
  });
  it("no sites: treated as new", () => {
    expect(briefFromConversation([user("build me a landing page")], { sites: [] }).resolution.kind).toBe("none");
  });
  it("a new business named in the message never inherits a site's brand, even when one is chosen", () => {
    const { resolution, brief, plan } = briefFromConversation([user("Build a landing page for Glow Studio, a nail salon")], { sites: [bakery], siteSignal: { explicitSiteId: bakery.id } });
    expect(resolution.kind).toBe("ask-new-or-add");
    expect(plan.questions[0].question).toBe(newOrAddQuestion("Crumb & Co"));
    expect(brief.name.value).toBe("Glow Studio");
    expect(brief.colors.status).toBe("missing");
  });
  it("the legacy account brand alone never counts as a chosen site's brand", () => {
    const { brief } = briefFromConversation([user("change my homepage")], { sites: [bakery, gym], brand: { name: "Account Co" } });
    expect(brief.colors.status).toBe("missing");
  });
});

describe("current-site cookie", () => {
  it("reads a valid id, ignores junk", () => {
    expect(readCurrentSiteCookie("a=1; plexo-site=site-gym-0001; b=2")).toBe("site-gym-0001");
    expect(readCurrentSiteCookie("plexo-site=%E0%A4%A")).toBeUndefined();
    expect(readCurrentSiteCookie("x=1")).toBeUndefined();
  });
});
