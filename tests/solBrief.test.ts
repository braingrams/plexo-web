import { describe, expect, it } from "vitest";
import cases from "./fixtures/solEvalPrompts.json";
import { SKIP_ANSWER, QUESTION_TEXT, applyAnswer, askArgsFor, extractColorWords, extractContacts, extractHexColors, extractName, extractQuotedCopy, newBrandFacts, parseBrief, planQuestions } from "@/lib/ai/solBrief";

const byId = (id: string) => cases.find((c) => c.id === id)!;
const plan = (text: string, extra: Partial<Parameters<typeof parseBrief>[0]> = {}) => {
  const input = { text, ...extra };
  const brief = parseBrief(input);
  return { brief, plan: planQuestions(brief, input) };
};
const keys = (p: ReturnType<typeof plan>) => p.plan.questions.map((q) => q.key);

describe("extractors", () => {
  it("reads hex colours (3 and 6 digits) and colour words", () => {
    expect(extractHexColors("use #abc and #E4572E, not #12")).toEqual(["#AABBCC", "#E4572E"]);
    expect(extractColorWords("navy and forest green with a royal blue accent")).toEqual(["navy", "forest green", "royal blue"]);
  });
  it("reads emails, phones, links and social handles", () => {
    const c = extractContacts("Email hello@crumb.com or call +233 24 123 4567. See https://crumb.com and https://instagram.com/crumb, also @crumbandco");
    expect(c.emails).toEqual(["hello@crumb.com"]);
    expect(c.phones).toEqual(["+233 24 123 4567"]);
    expect(c.urls).toEqual(["https://crumb.com"]);
    expect(c.socials).toContain("https://instagram.com/crumb");
    expect(c.socials).toContain("@crumbandco");
  });
  it("keeps quoted copy and ignores short quotes", () => {
    expect(extractQuotedCopy('Headline: "Fresh from our oven to your Saturday." and "Hi"')).toEqual(["Fresh from our oven to your Saturday."]);
  });
  it("finds a business name in several phrasings", () => {
    expect(extractName("Create a website for Iron Haven Gym. We're strong.")).toBe("Iron Haven Gym");
    expect(extractName("Website for Glow Studio, a nail salon in Nairobi")).toBe("Glow Studio");
    expect(extractName("my business is called Sunrise Print Shop")).toBe("Sunrise Print Shop");
    expect(extractName("Make me a website for my bakery in Accra")).toBeUndefined();
    expect(extractName("build me a landing page for a SaaS that sends invoices")).toBeUndefined();
  });
});

describe("simple prompts: ask a short, ordered set", () => {
  it("'build me a landing page' asks the six highest-impact questions, offer first", () => {
    const p = plan(byId("simple-landing").text);
    expect(p.brief.richness.level).toBe("simple");
    expect(p.plan.mode).toBe("ask");
    expect(keys(p)).toEqual(["offer", "name", "audience", "cta", "tone", "brand"]);
    expect(p.plan.questions.length).toBeLessThanOrEqual(6);
    for (const q of p.plan.questions) expect(q.options.length).toBeGreaterThanOrEqual(2);
  });
  it("does not re-ask what the prompt already answered", () => {
    const p = plan(byId("simple-store").text);
    expect(keys(p)).not.toContain("cta");
    const b = plan(byId("simple-bakery").text);
    expect(keys(b)).not.toContain("offer");
  });
  it("detects the page goal and the industry", () => {
    expect(plan("build me a landing page").brief.goal.value).toBe("landing");
    expect(plan(byId("simple-bakery").text).brief.industry.value).toBe("bakery");
  });
});

describe("medium prompts", () => {
  it("captures name, tone, colours and the action, and asks only what is missing (max 4)", () => {
    const p = plan(byId("medium-saas").text);
    expect(p.brief.colors.value).toEqual(["#22C55E"]);
    expect(p.brief.cta.value).toBe("Sign up");
    expect(keys(p)).not.toContain("cta");
    expect(keys(p)).not.toContain("brand");
    expect(p.plan.questions.length).toBeLessThanOrEqual(4);
  });
  it("'no logo' is understood and never asked about", () => {
    const p = plan(byId("medium-nologo").text);
    expect(p.brief.logo.value).toBe("none");
    expect(p.brief.name.value).toBe("Glow Studio");
    expect(keys(p)).not.toContain("logo");
    expect(keys(p)).not.toContain("name");
    expect(keys(p)).not.toContain("tone");
  });
  it("asks only for a logo when colours are given but no logo is mentioned", () => {
    const p = plan("Build a landing page for Zed Tech, a software startup. Our colours are #0F766E and #F59E0B. Developers should sign up.");
    expect(keys(p)).toContain("logo");
    expect(keys(p)).not.toContain("brand");
  });
  it("detects other languages and still plans questions", () => {
    const fr = plan(byId("fr-boulangerie").text);
    expect(fr.brief.language.value).toBe("French");
    expect(fr.brief.name.value).toBe("Le Petit Pain");
    expect(fr.plan.mode).toBe("ask");
    const es = plan(byId("es-clinic").text);
    expect(es.brief.language.value).toBe("Spanish");
    expect(es.brief.name.value).toBe("Sonrisa Clara");
  });
});

describe("rich briefs: welcome every detail, ask (almost) nothing", () => {
  const rich = plan(byId("rich-brief").text);
  it("is scored rich and asks nothing", () => {
    expect(rich.brief.richness.level).toBe("rich");
    expect(rich.plan.mode).toBe("build");
    expect(rich.plan.questions).toEqual([]);
    expect(rich.plan.reason).toBe("enough");
  });
  it("never discards a detail the owner gave", () => {
    const b = rich.brief;
    expect(b.name.value).toMatch(/^Crumb & Co/);
    expect(b.colors.value).toEqual(["#C2410C", "#FFF8F1", "#3B2314"]);
    expect(b.logo.value).toBe("none");
    expect(b.fonts.value).toBe("Fraunces + Inter");
    expect(b.cta.value).toMatch(/Order a cake/);
    expect(b.audience.value).toMatch(/busy young professionals/);
    expect(b.tone.value).toMatch(/warm/);
    expect(b.content.headlines).toContain("Fresh from our oven to your Saturday.");
    expect(b.content.emails).toEqual(["hello@crumbandco.com"]);
    expect(b.content.phones).toEqual(["+233 24 123 4567"]);
    expect(b.content.socials).toContain("https://instagram.com/crumbandco");
    expect(b.content.prices.join(" ")).toMatch(/GHS 45/);
    expect(b.content.hasPhotos).toBe(true);
    expect(b.sections.value).toContain("testimonials");
    expect(b.sections.value!.length).toBeGreaterThanOrEqual(6);
    expect(b.constraints).toEqual(expect.arrayContaining(["No stock photos.", "Mobile first."]));
  });
  it("asks exactly one question when something critical is truly missing", () => {
    const text = byId("rich-brief").text.replace(/Crumb & Co\.?/g, "our bakery").replace(/crumbandco/g, "ourbakery");
    const p = plan(text);
    expect(p.brief.richness.level).not.toBe("simple");
    expect(p.plan.questions.length).toBeLessThanOrEqual(1);
  });
});

describe("what is already known is never asked", () => {
  const site = { name: "Ama's Bakery", colors: ["#1F6F4A", "#F5E6C8"], logoUrl: "https://cdn.example/logo.png", about: "Cakes and pastries in Accra", industry: "bakery", tone: "warm" };
  it("uses the site's brand and says so in one line", () => {
    const p = plan("build me a landing page for our new cake subscription", { site });
    expect(keys(p)).not.toEqual(expect.arrayContaining(["name"]));
    expect(keys(p)).not.toContain("brand");
    expect(keys(p)).not.toContain("logo");
    expect(keys(p)).not.toContain("tone");
    expect(keys(p)).not.toContain("offer");
    expect(p.plan.understood).toContain("I'll use your brand (name, colours, logo)");
  });
  it("falls back to the account's brand, with the site winning", () => {
    const p = plan("make me a landing page", { account: { name: "Account Co", colors: ["#111111"] }, site: { colors: ["#222222"] } });
    expect(p.brief.colors.value).toEqual(["#222222"]);
    expect(p.brief.name.value).toBe("Account Co");
    expect(p.brief.name.source).toBe("account");
  });
  it("a different business named in the prompt does not inherit the old brand", () => {
    const p = plan("Build a landing page for Iron Haven Gym", { site });
    expect(p.brief.name.value).toBe("Iron Haven Gym");
    expect(p.brief.colors.status).toBe("missing");
    expect(keys(p)).toContain("brand");
  });
  it("an attached logo is used and its colours become the palette", () => {
    const p = plan("here is my logo, build me a landing page for my tutoring business", { attachments: [{ type: "image", filename: "logo.png", colors: ["#7C3AED", "#F59E0B"] }] });
    expect(p.brief.logo.value).toBe("uploaded");
    expect(p.brief.colors.value).toEqual(["#7C3AED", "#F59E0B"]);
    expect(keys(p)).not.toContain("brand");
    expect(keys(p)).not.toContain("logo");
  });
  it("never asks again after the intake round, or for changes to existing work", () => {
    expect(plan("build me a landing page", { alreadyAsked: true }).plan.reason).toBe("already-asked");
    expect(plan(byId("edit-existing").text).plan.reason).toBe("not-new-build");
    expect(plan("build me a landing page", { alreadyBuilt: true }).plan.mode).toBe("build");
  });
});

describe("skip and just build", () => {
  it("states its assumptions instead of asking", () => {
    const p = plan(byId("skip-just-build").text);
    expect(p.brief.skip).toBe(true);
    expect(p.plan.mode).toBe("build");
    expect(p.plan.reason).toBe("skip");
    expect(p.plan.assumptions.join(" ")).toMatch(/palette/);
    expect(p.plan.assumptions.join(" ")).toMatch(/wordmark/);
    expect(p.plan.assumptions.join(" ")).toMatch(/sample/);
  });
  it("'Skip, you choose' on every answer leaves it to SOL", () => {
    const b = parseBrief({ text: "build me a landing page" });
    for (const k of Object.keys(QUESTION_TEXT) as Array<keyof typeof QUESTION_TEXT>) applyAnswer(b, QUESTION_TEXT[k], SKIP_ANSWER);
    expect(b.skip).toBe(true);
    expect(b.name.status).toBe("missing");
  });
});

describe("answers fill the brief", () => {
  it("maps each answer back to its field and builds without a second round", () => {
    const input = {
      text: "build me a landing page",
      alreadyAsked: true,
      answers: [
        { question: QUESTION_TEXT.offer, answer: "We bake custom cakes in Accra" },
        { question: QUESTION_TEXT.name, answer: "Ama's Cakes" },
        { question: QUESTION_TEXT.audience, answer: "Families planning birthdays" },
        { question: QUESTION_TEXT.cta, answer: "Order a cake" },
        { question: QUESTION_TEXT.tone, answer: "Warm and friendly" },
        { question: QUESTION_TEXT.brand, answer: "I have colours: #C2410C and cream" },
      ],
    };
    const b = parseBrief(input);
    expect(b.name.value).toBe("Ama's Cakes");
    expect(b.offer.source).toBe("answer");
    expect(b.industry.value).toBe("bakery");
    expect(b.colors.value).toEqual(["#C2410C", "cream"]);
    expect(planQuestions(b, input).mode).toBe("build");
  });
  it("'no logo' answered from the colours-and-logo card means a wordmark", () => {
    const b = parseBrief({ text: "build me a landing page", answers: [{ question: QUESTION_TEXT.brand, answer: "No logo, make a simple wordmark" }] });
    expect(b.logo.value).toBe("none");
  });
});

describe("planner shape", () => {
  it("emits ask_user_question arguments the tool schema accepts (2-4 options, <=6 questions)", () => {
    const args = askArgsFor(plan("build me a landing page").plan);
    expect(args.questions.length).toBeLessThanOrEqual(6);
    for (const q of args.questions) {
      expect(q.options.length).toBeGreaterThanOrEqual(2);
      expect(q.options.length).toBeLessThanOrEqual(4);
      expect(q.header.split(" ").length).toBeLessThanOrEqual(3);
      expect(q.options.some((o) => /^(other|something else)$/i.test(o.label))).toBe(false);
    }
  });
  it("offers to save only genuinely new brand facts", () => {
    const b = parseBrief({ text: "Build a landing page, colours #C2410C and #F59E0B, no logo" });
    expect(newBrandFacts(b, undefined)).toEqual({ colors: ["#C2410C", "#F59E0B"], noLogo: true, hasChange: true });
    expect(newBrandFacts(b, { colors: ["#C2410C", "#F59E0B"], noLogo: true }).hasChange).toBe(false);
  });
  it("covers every eval prompt without throwing, asking at most 6", () => {
    for (const c of cases) {
      const input = { text: c.text, alreadyBuilt: (c as { alreadyBuilt?: boolean }).alreadyBuilt };
      const out = planQuestions(parseBrief(input), input);
      expect(out.questions.length).toBeLessThanOrEqual(6);
    }
  });
});
