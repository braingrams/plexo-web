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
  getPageRecipe,
  PAGE_RECIPES,
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

function score(r: PageRecipe, industry: SiteIndustry, style: SiteStyle, goal: string | undefined, aboutText: string): number {
  let s = 0;
  const text = aboutText.toLowerCase();

  // Industry fit: specific industry recipes get priority
  if (industry !== "general") {
    if (r.industries.includes(industry)) s += 6;
    else if (r.industries.includes("general")) s += 2;
  } else {
    s += r.industries.includes("general") ? 3 : 0;
  }

  // Visual style fit
  if (r.styles.includes(style)) s += 3;

  // Semantic intent from owner's words & goal
  if (/\b(show|shows|perform|performance|performances|music|artist|singer|dance|creator|video|gallery|portfolio|entertain)\b/i.test(text)) {
    if (r.id === "home-editorial" || r.id === "home-bold") s += 8;
    if (r.id === "landing-waitlist") s -= 5;
  }
  if (/\b(food|restaurant|chef|cook|cooking|bake|bakery|cafe|kitchen|menu)\b/i.test(text)) {
    if (r.id === "home-hospitality" || r.id === "home-local") s += 8;
  }
  if (goal === "store") {
    if (r.id === "home-shop") s += 12;
  } else if (/\b(shop|store|sell|product|merch|clothing|boutique|order|buy)\b/i.test(text)) {
    if (r.id === "home-shop" || r.id === "landing-sales") s += 7;
  }
  if (/\b(course|class|learn|lesson|coach|coaching|train|academy|book|guide)\b/i.test(text) || goal === "course") {
    if (r.id === "landing-course") s += 7;
  }
  if (/\b(software|app|saas|api|tech|platform|startup)\b/i.test(text)) {
    if (r.id === "home-product" || r.id === "home-bold") s += 6;
  }
  if (/\b(charity|nonprofit|cause|donate|donation|give|community|church)\b/i.test(text)) {
    if (r.id === "home-cause") s += 8;
  }
  if (/\b(waitlist|coming soon|launching soon|pre-launch)\b/i.test(text)) {
    if (r.id === "landing-waitlist") s += 8;
  }

  return s;
}

/** Every design from the kit, ranked so the best fit for their brand and description is first. */
export function rankDesigns(p: SolBuildProfile): PageRecipe[] {
  const brief = briefFromProfile(p);
  const industry = detectIndustry(brief);
  const style = detectStyle({ tone: brief.tone, industry: brief.industry, about: brief.about, name: brief.name });
  const aboutText = `${brief.name} ${brief.about ?? ""} ${p.goal ?? ""}`;
  const targetType = pageTypeForGoal(p.goal);
  const candidates = PAGE_RECIPES.filter((r) => r.pageType === targetType);

  return candidates
    .map((r, i) => ({ r, i, s: score(r, industry, style, p.goal, aboutText) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.r);
}

export const toChoice = (r: PageRecipe): DesignChoice => ({ id: r.id, name: r.name, description: r.description });

/** Top designs chosen for this owner, and the full ranked catalog for "Change design" and "See all designs". */
export function pickDesigns(p: SolBuildProfile, count = 3): { top: DesignChoice[]; others: DesignChoice[] } {
  const ranked = rankDesigns(p).map(toChoice);
  return { top: ranked.slice(0, count), others: ranked.slice(count) };
}

/** One design as a complete page in the owner's brand (their name, logo, colours, fonts and words). */
export function renderDesign(p: SolBuildProfile, recipeId: string): RenderedDesign | null {
  const recipe = getPageRecipe(recipeId) ?? PAGE_RECIPES.find((r) => r.id === recipeId) ?? recipesFor(pageTypeForGoal(p.goal)).find((r) => r.id === recipeId);
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
