/**
 * SOL personalization for onboarding designs:
 * Generates tailored headlines, offerings, and copy based on the user's brand name,
 * goal, and description, and personalizes the template preview.
 */
import {
  compilePageToHtml,
  buildSitePage,
  designSystemFromBrief,
  detectIndustry,
  detectStyle,
  recipesFor,
  siteNavLinks,
  type SiteBrief,
} from "@charisol/plexo-sdk/v2/compile";
import type { SolBuildProfile } from "@/lib/ai/solBuildContext";
import { briefFromProfile, pageTypeForGoal } from "./designs";

export type PersonalizedResult = {
  html: string;
  summary: string;
  headlines: {
    hero: string;
    subhero: string;
    cta: string;
  };
};

/**
 * Intelligent client-or-server personalization:
 * Extracts rich brand context from name, about, and goal, then compiles
 * an elevated personalized page.
 */
export function personalizeTemplateLocally(
  profile: SolBuildProfile,
  recipeId: string,
): PersonalizedResult {
  const brief = briefFromProfile(profile);
  const name = brief.name || "Your Brand";
  const about = brief.about || "";
  const goal = profile.goal || "business-site";

  const industry = detectIndustry(brief);
  const tone = detectStyle({ tone: brief.tone, industry: brief.industry, about: brief.about, name: brief.name });

  const recipe = recipesFor(pageTypeForGoal(goal)).find((r) => r.id === recipeId) || recipesFor(pageTypeForGoal(goal))[0];

  // Derive intelligent tailored headlines from brand name and description
  let hero = `Welcome to ${name}`;
  let subhero = about.trim() || `The premier destination for handcrafted excellence and dedicated service.`;
  let cta = goal === "store" ? "Explore Collection" : goal === "course" ? "Start Learning" : "Get Started";

  if (about.toLowerCase().includes("italian") || about.toLowerCase().includes("food") || about.toLowerCase().includes("chef") || about.toLowerCase().includes("cook")) {
    hero = `Savour the Art of Dining at ${name}`;
    subhero = about.trim() || `Handcrafted recipes, unforgettable flavours, and an authentic culinary experience made with passion.`;
    cta = "Reserve Your Table";
  } else if (about.toLowerCase().includes("clinic") || about.toLowerCase().includes("health") || about.toLowerCase().includes("wellness") || about.toLowerCase().includes("therapy")) {
    hero = `Compassionate, Holistic Care at ${name}`;
    subhero = about.trim() || `Empowering your wellness journey with personalized treatment and dedicated support.`;
    cta = "Book a Consultation";
  } else if (about.toLowerCase().includes("agency") || about.toLowerCase().includes("design") || about.toLowerCase().includes("studio") || about.toLowerCase().includes("tech")) {
    hero = `Designed for Impact. Built by ${name}.`;
    subhero = about.trim() || `We craft exceptional digital experiences and strategies that help modern businesses thrive.`;
    cta = "Start a Project";
  } else if (about.trim()) {
    hero = `${name} — ${about.slice(0, 45).replace(/[.,;]$/, "")}`;
    subhero = about.trim();
  }

  const enhancedBrief: SiteBrief & { name: string } = {
    ...brief,
    name,
    about: subhero,
    industry,
    tone,
  };

  const { designSystem } = designSystemFromBrief(enhancedBrief);
  const nav = siteNavLinks(
    goal === "store"
      ? [{ name: "Home", path: "/" }, { name: "Shop", path: "/store" }, { name: "Story", path: "/about" }, { name: "Contact", path: "/contact" }]
      : recipe?.pageType === "landing"
      ? []
      : [{ name: "Home", path: "/" }, { name: "About", path: "/about" }, { name: "Services", path: "/services" }, { name: "Contact", path: "/contact" }],
    5,
  );

  const built = buildSitePage(
    { pageType: recipe?.pageType || "home", name: "Home", recipeId: recipe?.id },
    {
      brief: enhancedBrief,
      designSystem,
      seed: `personalized-${name}`,
      chrome: true,
      nav,
      navCta: { label: cta, href: goal === "store" ? "/store" : "/contact" },
    },
  );

  let compiled = compilePageToHtml(built.page, { designSystem, title: name, runtime: "none" }).document;

  // Enhance compiled HTML with tailored hero and subhero if present
  if (hero && subhero) {
    compiled = compiled
      .replace(/(<h1[^>]*>)(.*?)(<\/h1>)/i, `$1${escapeHtml(hero)}$3`)
      .replace(/(<p[^>]*class="[^"]*lead[^"]*"[^>]*>)(.*?)(<\/p>)/i, `$1${escapeHtml(subhero)}$3`);
  }

  return {
    html: compiled,
    summary: `Tailored headlines, custom tone (${tone}), and brand narrative for ${name}`,
    headlines: { hero, subhero, cta },
  };
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
