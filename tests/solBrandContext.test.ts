import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  for (const t of ["CORE", "LEDGER", "COMMERCE", "CONTENT", "OPS", "IMPORT", "SOL"]) process.env[`PLEXO_${t}_TABLE`] = `test-${t.toLowerCase()}`;
});

import { briefFromConversation, discoveryPrompt } from "@/lib/ai/solDiscovery";
import { checkPage } from "@/lib/ai/solQuality";
import { knownBrandFromResolved, mergeBrand } from "@/lib/brand/brandModel";
import { pristineDocument } from "./fixtures/solQualityFixtures";
import { LINKED_AMA } from "./fixtures/strataBrandFixtures";

const user = (text: string) => ({ role: "user" as const, content: [{ type: "text", text }] });

const linked = mergeBrand({ siteId: "ama", siteName: "Ama's Kitchen", linked: LINKED_AMA });
const amaSite = { id: "ama", name: "Ama's Kitchen", updatedAt: "2026-11-10", brand: knownBrandFromResolved(linked), resolvedBrand: linked };
const otherSite = { id: "kofi", name: "Kofi Tours", updatedAt: "2026-11-01", brand: { colors: ["#0F766E"] } };

describe("SOL context: the linked brand is known without the owner saying a word", () => {
  it("an edit on the only site reads the Strata colours, fonts and logo into the brief", () => {
    const { brief, resolution } = briefFromConversation([user("add a pricing page")], { sites: [amaSite] });
    expect(resolution.kind).toBe("use");
    expect(brief.colors).toMatchObject({ status: "known", source: "site" });
    expect(brief.colors.value?.[0]).toBe("#E4572E");
    expect(brief.fonts.value).toBe("Plus Jakarta Sans + Inter");
    expect(brief.logo.status).toBe("known");
    expect(brief.strataProject).toBe("Ama's Kitchen brand");
  });
  it("so SOL is not asked to ask for colours or a logo", () => {
    const { plan } = briefFromConversation([user("build me a landing page for my catering")], { sites: [amaSite], siteSignal: { explicitSiteId: "ama" } });
    expect(plan.questions.map((q) => q.key)).not.toContain("brand");
    expect(plan.questions.map((q) => q.key)).not.toContain("logo");
  });
  it("the system prompt carries the brand block on an edit (not just on a new build), and tells SOL to say it once", () => {
    const { brief, plan, resolution } = briefFromConversation([user("make the hero button bigger")], { sites: [amaSite] });
    const text = discoveryPrompt(brief, plan, resolution);
    expect(text).toContain("This site's brand");
    expect(text).toContain("primary #E4572E");
    expect(text).toContain("I'll use your Ama's Kitchen brand.");
    expect(text).toMatch(/Never ask the owner for colours, fonts or a logo/);
  });
  it("a different site's brand never leaks in", () => {
    const { brief, resolution } = briefFromConversation([user("add a gallery")], { sites: [amaSite, otherSite], siteSignal: { explicitSiteId: "kofi" } });
    expect(resolution.kind).toBe("use");
    expect(brief.colors.value).toEqual(["#0F766E"]);
    expect(brief.strataProject).toBeUndefined();
    const text = discoveryPrompt(brief, briefFromConversation([user("add a gallery")], { sites: [amaSite, otherSite], siteSignal: { explicitSiteId: "kofi" } }).plan, resolution);
    expect(text).not.toContain("#E4572E");
  });
  it("two sites and no choice: no brand is taken from either", () => {
    const { brief } = briefFromConversation([user("add a gallery")], { sites: [amaSite, otherSite] });
    expect(brief.colors.status).toBe("missing");
  });
  it("a brand changed in Strata reaches the very next turn (the block is rebuilt from what was resolved now)", () => {
    const changed = mergeBrand({ siteId: "ama", siteName: "Ama's Kitchen", linked: { ...LINKED_AMA, designSystem: { ...LINKED_AMA.designSystem, tokens: LINKED_AMA.designSystem.tokens.map((t) => (t.key === "--color-brand-primary-500" ? { ...t, value: "#1F6FEB" } : t)) } } });
    const site = { ...amaSite, brand: knownBrandFromResolved(changed), resolvedBrand: changed };
    const { brief, plan, resolution } = briefFromConversation([user("add a pricing page")], { sites: [site] });
    expect(discoveryPrompt(brief, plan, resolution)).toContain("primary #1F6FEB");
    expect(discoveryPrompt(brief, plan, resolution)).not.toContain("#E4572E");
  });
});

describe("the quality gate checks adherence to the linked tokens", () => {
  const { brief } = briefFromConversation([user("add a pricing page")], { sites: [amaSite] });
  const good = pristineDocument().replace(/#C2410C/g, "#E4572E").replace(/Crumb &amp; Co/g, "Ama's Kitchen").replace(/Fraunces/g, "Plus Jakarta Sans");
  const colourFinding = (html: string) => checkPage({ html, brief }).findings.find((f) => f.id === "brand-colour");
  it("a page using the brand's main colour passes the colour check", () => expect(colourFinding(good)).toBeUndefined());
  it("a page in some other colour fails it, as a must-fix", () => expect(colourFinding(good.replace(/#E4572E/gi, "#0F766E"))?.severity).toBe("must"));
  it("a page that takes its main colour from the brand's variables (the hosted sheet defines them) also passes", () => {
    const viaVar = good.replace(/#E4572E/gi, "var(--color-action-primary-bg)");
    expect(colourFinding(viaVar)).toBeUndefined();
  });
  it("without a linked project, a variable is not enough (it can't be checked)", () => {
    const plain = { ...brief, strataProject: undefined };
    const viaVar = good.replace(/#E4572E/gi, "var(--color-action-primary-bg)");
    expect(checkPage({ html: viaVar, brief: plain }).findings.some((f) => f.id === "brand-colour")).toBe(true);
  });
});

describe("SOL's brand rules for apps with their own code", () => {
  it("say once to use the brand variables and keep the sheet link in the layout, and not to bother the owner", async () => {
    const { BRAND_RULES_GUIDE } = await import("@/lib/ai/solDiscovery");
    expect(BRAND_RULES_GUIDE.split("APPS WITH THEIR OWN CODE").length - 1).toBe(1);
    expect(BRAND_RULES_GUIDE.split("/__plexo/brand/<site id>.css").length - 1).toBe(1);
    expect(BRAND_RULES_GUIDE).toContain("var(--color-brand-primary-500)");
    expect(BRAND_RULES_GUIDE).toContain("Add my brand to my app");
  });
});
