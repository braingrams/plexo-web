/**
 * SOL personalization for onboarding designs:
 * Edits the selected template's HTML directly, personalizing it with the user's
 * brand name, description, industry narrative, logo, and colors, rather than
 * regenerating a procedural page from scratch.
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
import { FIXTURE_DESIGNS } from "./marketDesignsFixture";

export type PersonalizedResult = {
  html: string;
  summary: string;
  headlines: {
    hero: string;
    subhero: string;
    cta: string;
  };
};

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Directly personalizes an existing template HTML document with the owner's brand name,
 * about text, tailored headlines, and visual assets without replacing the template's layout.
 */
export function personalizeTemplateHtml(input: {
  html: string;
  name: string;
  about?: string;
  goal?: string;
  templateName?: string;
  templateDescription?: string;
  brandColor?: string;
  logoUrl?: string;
}): PersonalizedResult {
  let html = input.html;
  const name = input.name.trim() || "Your Brand";
  const about = (input.about || "").trim();
  const aboutLower = about.toLowerCase();

  // 1. Extract the template's original brand/creator name from templateName (e.g. "Chef Tomi: food creator...")
  const rawTemplateName = (input.templateName || "").trim();
  const colonIdx = rawTemplateName.search(/[:—–-]/);
  const originalBrandName = (colonIdx > 0 ? rawTemplateName.slice(0, colonIdx) : rawTemplateName).trim();

  // Replace original brand name in text nodes outside of tags
  if (originalBrandName && name && originalBrandName.toLowerCase() !== name.toLowerCase()) {
    // Replace in <title>
    html = html.replace(/<title>([\s\S]*?)<\/title>/gi, (_, content) => {
      const updated = content.replace(new RegExp(escapeRegex(originalBrandName), "gi"), name);
      return `<title>${updated}</title>`;
    });

    // Replace in visible text between HTML tags
    const parts = html.split(/(<[^>]+>)/g);
    const re = new RegExp(`\\b${escapeRegex(originalBrandName)}\\b`, "gi");
    for (let i = 0; i < parts.length; i += 2) {
      parts[i] = parts[i].replace(re, name);
    }
    html = parts.join("");
  }

  // 2. Intelligent tailored headlines from brand name and description
  let hero = "";
  let subhero = "";
  let cta = "Get started";

  if (
    aboutLower.includes("show") ||
    aboutLower.includes("performance") ||
    aboutLower.includes("gig") ||
    aboutLower.includes("tour") ||
    aboutLower.includes("concert") ||
    aboutLower.includes("music") ||
    aboutLower.includes("artist") ||
    aboutLower.includes("act") ||
    aboutLower.includes("theatre")
  ) {
    hero = `${name} — Live Shows & Performances`;
    subhero = about || `Catch upcoming live shows, exclusive performance recordings, and tour dates from ${name}.`;
    cta = "See upcoming shows";
  } else if (
    aboutLower.includes("chef") ||
    aboutLower.includes("food") ||
    aboutLower.includes("cook") ||
    aboutLower.includes("recipe") ||
    aboutLower.includes("bake") ||
    aboutLower.includes("restaurant") ||
    aboutLower.includes("culinary") ||
    aboutLower.includes("dining")
  ) {
    hero = `Savour Handcrafted Flavours with ${name}`;
    subhero = about || `Original recipes, culinary inspiration, and unforgettable dining experiences created by ${name}.`;
    cta = "Explore recipes & menu";
  } else if (
    aboutLower.includes("clinic") ||
    aboutLower.includes("health") ||
    aboutLower.includes("wellness") ||
    aboutLower.includes("therapy") ||
    aboutLower.includes("care") ||
    aboutLower.includes("doctor") ||
    aboutLower.includes("dental")
  ) {
    hero = `Compassionate, Holistic Care at ${name}`;
    subhero = about || `Empowering your wellness journey with personalized treatment and dedicated support.`;
    cta = "Book a consultation";
  } else if (
    aboutLower.includes("agency") ||
    aboutLower.includes("design") ||
    aboutLower.includes("studio") ||
    aboutLower.includes("tech") ||
    aboutLower.includes("software") ||
    aboutLower.includes("brand")
  ) {
    hero = `Designed for Impact. Built by ${name}.`;
    subhero = about || `We craft high-performance digital experiences and brand identities that help ambitious businesses grow.`;
    cta = "Start a project";
  } else if (
    aboutLower.includes("store") ||
    aboutLower.includes("shop") ||
    aboutLower.includes("apparel") ||
    aboutLower.includes("product") ||
    aboutLower.includes("wear") ||
    aboutLower.includes("jewel") ||
    aboutLower.includes("candle") ||
    input.goal === "store"
  ) {
    hero = `Handcrafted Quality from ${name}`;
    subhero = about || `Curated with care, delivered to your door. Discover our signature collection.`;
    cta = "Shop the collection";
  } else if (about) {
    if (about.length <= 48) {
      hero = `${name} — ${about.replace(/[.,;]+$/, "")}`;
    } else {
      hero = `${name} — ${about.slice(0, 45).replace(/[.,;]+$/, "")}`;
    }
    subhero = about;
  } else {
    hero = `Welcome to ${name}`;
    subhero = `Discover what makes ${name} unique. Crafted with care and built for you.`;
  }

  // 3. Update the <h1> in the template
  if (html.includes("<h1")) {
    html = html.replace(/(<h1[^>]*>)([\s\S]*?)(<\/h1>)/i, (m, openTag, currentH1, closeTag) => {
      return `${openTag}${escapeHtml(hero)}${closeTag}`;
    });
  }

  // 4. Update the subhero paragraph following <h1> or lead paragraph
  if (subhero) {
    let replacedLead = false;
    html = html.replace(/(<h1[^>]*>[\s\S]*?<\/h1>[\s\S]*?<p[^>]*>)([\s\S]*?)(<\/p>)/i, (m, before, currentP, after) => {
      replacedLead = true;
      return `${before}${escapeHtml(subhero)}${after}`;
    });
    if (!replacedLead) {
      html = html.replace(/(<p[^>]*class="[^"]*(?:lead|sub|hero|desc)[^"]*"[^>]*>)([\s\S]*?)(<\/p>)/i, (m, before, currentP, after) => {
        return `${before}${escapeHtml(subhero)}${after}`;
      });
    }
  }

  // 5. Update primary CTA button text if generic
  if (cta) {
    html = html.replace(/(<(?:a|button)[^>]*class="[^"]*(?:btn|cta|button|primary)[^"]*"[^>]*>)\s*(?:Get started|Learn more|Discover|Explore|Shop now|Start free)\s*(<\/(?:a|button)>)/i, (m, open, close) => {
      return `${open}${escapeHtml(cta)}${close}`;
    });
  }

  // 6. Update document title
  const pageTitle = hero.startsWith(name) ? hero : `${name} — ${hero}`;
  if (html.includes("<title>")) {
    html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(pageTitle)}</title>`);
  } else if (html.includes("<head>")) {
    html = html.replace("<head>", `<head><title>${escapeHtml(pageTitle)}</title>`);
  }

  // 7. Inject brand accent color if provided
  if (input.brandColor) {
    const colorStyle = `<style data-sol-brand="true">:root{--primary:${input.brandColor};--brand:${input.brandColor};--accent:${input.brandColor};}</style>`;
    if (html.includes("</head>")) {
      html = html.replace("</head>", `${colorStyle}</head>`);
    }
  }

  // 8. Replace logo image src if provided and template has logo img
  if (input.logoUrl) {
    html = html.replace(/(<img[^>]*class="[^"]*logo[^"]*"[^>]*src=")([^"]*)(")/i, `$1${escapeHtml(input.logoUrl)}$3`);
  }

  return {
    html,
    summary: `Personalized template headlines, intro narrative, and branding for "${name}".`,
    headlines: { hero, subhero, cta },
  };
}

/**
 * Primary personalization dispatcher:
 * Prioritizes personalizing the actual chosen template HTML.
 */
export async function personalizeTemplate(input: {
  profile: SolBuildProfile;
  designId?: string;
  templateHtml?: string;
  templateName?: string;
  templateDescription?: string;
}): Promise<PersonalizedResult> {
  let html = input.templateHtml;
  let templateName = input.templateName;
  let templateDescription = input.templateDescription;

  const brief = briefFromProfile(input.profile);
  const name = brief.name || "Your Brand";
  const about = brief.about || "";
  const goal = input.profile.goal || "business-site";
  const brandColor = input.profile.brand?.colors?.[0];
  const logoUrl = input.profile.brand?.logoUrl;

  // If html was not sent directly, try to load it for designId
  if (!html && input.designId) {
    try {
      const { Template } = await import("@/lib/db/contentEntities");
      const { data: item } = await Template.get({ id: input.designId }).go();
      if (item?.compiledHtml) {
        html = item.compiledHtml;
        templateName = templateName || item.name;
        templateDescription = templateDescription || item.marketplaceDescription || undefined;
      }
    } catch {
      // not in db or db unavailable
    }
  }

  if (!html && input.designId) {
    const fixture = FIXTURE_DESIGNS.find((f) => f.id === input.designId);
    if (fixture?.compiledHtml) {
      html = fixture.compiledHtml;
      templateName = templateName || fixture.name;
      templateDescription = templateDescription || (fixture.description ?? undefined);
    }
  }

  if (html) {
    return personalizeTemplateHtml({
      html,
      name,
      about,
      goal,
      templateName,
      templateDescription,
      brandColor,
      logoUrl,
    });
  }

  // Fallback only if no template could be located
  return personalizeTemplateLocally(input.profile, input.designId || "home-lead");
}

/**
 * Procedural fallback for generating a page when no template is selected.
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

  let hero = `Welcome to ${name}`;
  let subhero = about.trim() || `The premier destination for handcrafted excellence and dedicated service.`;
  let cta = goal === "store" ? "Explore Collection" : goal === "course" ? "Start Learning" : "Get Started";

  if (about.toLowerCase().includes("show") || about.toLowerCase().includes("performance") || about.toLowerCase().includes("music")) {
    hero = `${name} — Live Shows & Performances`;
    subhero = about.trim() || `Catch upcoming shows and performances from ${name}.`;
    cta = "See upcoming shows";
  } else if (about.toLowerCase().includes("italian") || about.toLowerCase().includes("food") || about.toLowerCase().includes("chef") || about.toLowerCase().includes("cook")) {
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
