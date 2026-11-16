/**
 * Picks the designs shown at the end of onboarding and renders each one with the owner's own
 * name, logo, colours, fonts and words. Uses the same site kit site_create builds with
 * (@charisol/plexo-sdk/v2/compile), so what they see is what they get. Never shown to owners
 * as a "template": they're just "designs".
 */
import {
  buildSitePage,
  compilePageToHtml,
  designSystemFromBrief,
  detectIndustry,
  detectStyle,
  recipesFor,
  siteNavLinks,
  type PageRecipe,
  type SiteBrief,
  type SiteIndustry,
  type SitePageType,
  type SiteStyle,
} from "@charisol/plexo-sdk/v2/compile";
import type { SolBuildProfile } from "@/lib/ai/solBuildContext";

export type DesignChoice = { id: string; name: string; description: string };
export type RenderedDesign = DesignChoice & { html: string };

/** Which page type holds the design for a goal: most sites lead with a home page, one-page goals with a landing page. */
export function pageTypeForGoal(goal: string | undefined): SitePageType {
  return goal === "course" || goal === "landing" || goal === "link-in-bio" ? "landing" : "home";
}

export function briefFromProfile(p: SolBuildProfile): SiteBrief & { name: string } {
  const b = p.brand ?? {};
  return {
    name: b.name?.trim() || "Your business",
    about: b.about || undefined,
    industry: b.industry || undefined,
    tone: b.tone || undefined,
    colors: b.colors?.length ? b.colors.slice(0, 4) : undefined,
    logoUrl: b.logoUrl && /^https?:\/\//i.test(b.logoUrl) ? b.logoUrl : undefined,
  };
}

function score(r: PageRecipe, industry: SiteIndustry, style: SiteStyle, goal: string | undefined): number {
  let s = 0;
  if (industry !== "general") s += r.industries.includes(industry) ? 4 : r.industries.includes("general") ? 1 : 0;
  else s += r.industries.includes("general") ? 2 : 0;
  if (r.styles.includes(style)) s += 3;
  if (goal === "store" && r.id === "home-shop") s += 3;
  if (goal === "course" && r.id === "landing-course") s += 4;
  if (goal === "link-in-bio" && r.id === "landing-waitlist") s += 2;
  if (goal === "blog" && (r.id === "home-editorial" || r.id === "home-classic")) s += 1;
  return s;
}

/** Every design for the goal, best fit first (ties keep the kit's own order so the result is stable). */
export function rankDesigns(p: SolBuildProfile): PageRecipe[] {
  const brief = briefFromProfile(p);
  const industry = detectIndustry(brief);
  const style = detectStyle({ tone: brief.tone, industry: brief.industry, about: brief.about, name: brief.name });
  const list = recipesFor(pageTypeForGoal(p.goal));
  return list
    .map((r, i) => ({ r, i, s: score(r, industry, style, p.goal) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.r);
}

export const toChoice = (r: PageRecipe): DesignChoice => ({ id: r.id, name: r.name, description: r.description });

/** The three designs chosen for this owner, and the rest for "See all designs". */
export function pickDesigns(p: SolBuildProfile, count = 3): { top: DesignChoice[]; others: DesignChoice[] } {
  const ranked = rankDesigns(p).map(toChoice);
  return { top: ranked.slice(0, count), others: ranked.slice(count) };
}

/** One design as a complete page in the owner's brand (their name, logo, colours, fonts and words). */
export function renderDesign(p: SolBuildProfile, recipeId: string): RenderedDesign | null {
  const recipe = recipesFor(pageTypeForGoal(p.goal)).find((r) => r.id === recipeId);
  if (!recipe) return null;
  const brief = briefFromProfile(p);
  const { designSystem } = designSystemFromBrief(brief);
  const nav = siteNavLinks(
    p.goal === "store"
      ? [{ name: "Home", path: "/" }, { name: "Shop", path: "/store" }, { name: "About", path: "/about" }, { name: "Contact", path: "/contact" }]
      : recipe.pageType === "landing"
        ? []
        : [{ name: "Home", path: "/" }, { name: "About", path: "/about" }, { name: "Services", path: "/services" }, { name: "Contact", path: "/contact" }],
    5,
  );
  const built = buildSitePage(
    { pageType: recipe.pageType, name: "Home", recipeId: recipe.id },
    { brief, designSystem, seed: `onboarding-${brief.name}`, chrome: true, nav, navCta: p.goal === "store" ? { label: "Shop now", href: "/store" } : { label: "Get in touch", href: "/contact" } },
  );
  const compiled = compilePageToHtml(built.page, { designSystem, title: brief.name, runtime: "none" });
  return { ...toChoice(recipe), html: compiled.document };
}
