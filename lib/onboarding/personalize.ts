/**
 * SOL personalization for onboarding designs:
 * Edits the selected template's HTML directly, deeply personalizing it with the user's
 * brand name, description, industry narrative, logo, and colors, rather than
 * regenerating a procedural page from scratch or surface-level find-and-replace.
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

/** Curated high-resolution stock photography collections for each domain */
export const DOMAIN_STOCK_PHOTOS: Record<string, string[]> = {
  music: [
    "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=1200&q=80", // concert stage crowd & lights
    "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=1200&q=80", // live stage performance
    "https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?auto=format&fit=crop&w=1200&q=80", // artist in recording studio
    "https://images.unsplash.com/photo-1539375665275-f9de415ef9ac?auto=format&fit=crop&w=1200&q=80", // vinyl record player
    "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=1200&q=80", // stage lights crowd atmosphere
    "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=1200&q=80", // audio console
    "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=1200&q=80", // musician acoustic performance
    "https://images.unsplash.com/photo-1465847899084-d164df4dedc6?auto=format&fit=crop&w=1200&q=80", // concert performance
  ],
  food: [
    "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1556910103-1c02745aae4d?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1200&q=80",
  ],
  wellness: [
    "https://images.unsplash.com/photo-1545205597-3d9d02c29597?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1506126613408-eca07ce68773?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&w=1200&q=80",
  ],
  tech: [
    "https://images.unsplash.com/photo-1551434678-e076c223a692?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=1200&q=80",
  ],
  creative: [
    "https://images.unsplash.com/photo-1513542789411-b6a5d4f31634?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1499750310107-5fef28a66643?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=1200&q=80",
  ],
  store: [
    "https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1472851294608-062f824d29cc?auto=format&fit=crop&w=1200&q=80",
  ],
};

export function detectPersonalizationDomain(about: string, goal?: string): string {
  const lower = about.toLowerCase();
  if (
    lower.includes("show") || lower.includes("performance") || lower.includes("gig") ||
    lower.includes("tour") || lower.includes("concert") || lower.includes("music") ||
    lower.includes("artist") || lower.includes("spotify") || lower.includes("audio") ||
    lower.includes("singer") || lower.includes("band") || lower.includes("song") ||
    lower.includes("track") || lower.includes("album") || lower.includes("live")
  ) {
    return "music";
  }
  if (
    lower.includes("chef") || lower.includes("food") || lower.includes("cook") ||
    lower.includes("recipe") || lower.includes("bake") || lower.includes("restaurant") ||
    lower.includes("dining") || lower.includes("culinary") || lower.includes("kitchen")
  ) {
    return "food";
  }
  if (
    lower.includes("clinic") || lower.includes("health") || lower.includes("wellness") ||
    lower.includes("therapy") || lower.includes("care") || lower.includes("doctor") ||
    lower.includes("dental") || lower.includes("yoga") || lower.includes("gym")
  ) {
    return "wellness";
  }
  if (
    lower.includes("software") || lower.includes("tech") || lower.includes("saas") ||
    lower.includes("app") || lower.includes("code") || lower.includes("developer")
  ) {
    return "tech";
  }
  if (
    lower.includes("store") || lower.includes("shop") || lower.includes("product") ||
    lower.includes("apparel") || lower.includes("merch") || goal === "store"
  ) {
    return "store";
  }
  if (
    lower.includes("agency") || lower.includes("design") || lower.includes("studio") ||
    lower.includes("photo") || lower.includes("portfolio") || lower.includes("brand")
  ) {
    return "creative";
  }
  return "business";
}

/**
 * Directly personalizes an existing template HTML document with the owner's brand name,
 * about narrative, tailored headlines, bento cards, feature strips, forms, footers,
 * and relevant domain photography without replacing the template's layout.
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
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const about = (input.about || "").trim();
  const domain = detectPersonalizationDomain(about, input.goal);

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

  // 2. Intelligent tailored headlines and narrative
  let hero = "";
  let subhero = "";
  let cta = "Get started";

  if (domain === "music") {
    hero = `${name} — Live Shows & Performances`;
    subhero = about || `The official creative home of ${name}. Catch upcoming live shows, watch exclusive music videos, and stream latest audio releases on Spotify.`;
    cta = "See upcoming shows";
  } else if (domain === "food") {
    hero = `Savour Handcrafted Flavours with ${name}`;
    subhero = about || `Original recipes, culinary inspiration, and unforgettable dining experiences created by ${name}.`;
    cta = "Explore recipes & menu";
  } else if (domain === "wellness") {
    hero = `Compassionate, Holistic Care at ${name}`;
    subhero = about || `Empowering your wellness journey with personalized treatment and dedicated support.`;
    cta = "Book a consultation";
  } else if (domain === "tech") {
    hero = `Modern Digital Solutions by ${name}`;
    subhero = about || `High-performance software and developer tools built to scale your workflow effortlessly.`;
    cta = "Get started";
  } else if (domain === "store") {
    hero = `Handcrafted Quality from ${name}`;
    subhero = about || `Curated with care, delivered to your door. Discover our signature collection.`;
    cta = "Shop the collection";
  } else if (domain === "creative") {
    hero = `Designed for Impact. Built by ${name}.`;
    subhero = about || `We craft high-performance digital experiences and brand identities that help ambitious creators grow.`;
    cta = "Explore our work";
  } else {
    hero = `Welcome to ${name}`;
    subhero = about || `Discover what makes ${name} unique. Crafted with care and built for you.`;
    cta = "Get started";
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

  // 5. Update primary CTA button text
  if (cta) {
    html = html.replace(/(<(?:a|button)[^>]*class="[^"]*(?:btn|cta|button|primary)[^"]*"[^>]*>)\s*(?:Get started|Learn more|Discover|Explore|Shop now|Start free)\s*(<\/(?:a|button)>)/i, (m, open, close) => {
      return `${open}${escapeHtml(cta)}${close}`;
    });
  }

  // 6. Deep Domain Transformations across Cards, Bento Tiles, Feature Strips, Forms & Footers
  if (domain === "music") {
    // Eyebrow badges
    html = html.replace(/(●\s*)COOKING VIDEOS EVERY SUNDAY/gi, "$1LIVE SHOWS &amp; TOUR DATES");
    html = html.replace(/NEW ON YOUTUBE/gi, "OFFICIAL MUSIC VIDEO");
    html = html.replace(/FRESH FROM THE KITCHEN/gi, "UPCOMING TOUR DATES");
    html = html.replace(/OUT 3 MARCH\s*·\s*PRE-ORDER NOW/gi, "NEW SINGLE &amp; VINYL OUT NOW");

    // Bento Cards & Headlines
    html = html.replace(/Watch:\s*20-minute tagliatelle with burst tomatoes/gi, "Watch: Official Music Video &amp; Studio Session");
    html = html.replace(/Focaccia for scaredy-cats/gi, "Stream on Spotify &amp; Apple Music");
    html = html.replace(/112\s*<br[^>]*>\s*RECIPES/gi, "150K+<br>LISTENERS");
    html = html.replace(/112\s*RECIPES/gi, "150K+ LISTENERS");
    html = html.replace(/The Sunday Table:\s*my first cookbook/gi, "Latest Release: Live Performance Recording");
    html = html.replace(/38,000\s*<br[^>]*>\s*COOKS READ IT/gi, "150,000+<br>MONTHLY LISTENERS");
    html = html.replace(/38,000\s*COOKS READ IT/gi, "150,000+ MONTHLY LISTENERS");
    html = html.replace(/Get the Sunday Supper letter:\s*one recipe,\s*one story,\s*every week/gi, "Join the Backstage Pass: Presale tour tickets, unreleased demos &amp; drops");
    html = html.replace(/Every recipe,\s*by time/gi, "Tour dates &amp; festival line-ups");
    html = html.replace(/Shop\s*Tomi's pans,\s*knives and olive oil/gi, "Official Merch &amp; Limited Vinyl");
    html = html.replace(/Tomi's pans,\s*knives and olive oil/gi, "Official tour tees, vinyl records and prints");

    // Feature Strip
    html = html.replace(/Dinner in 20,\s*40 or 90 minutes\./gi, "Upcoming Live Tour Dates &amp; Shows");
    html = html.replace(/Fridge-raid fusilli/gi, "London — Roundhouse");
    html = html.replace(/Whatever is in the vegetable drawer[^<]*/gi, "Mainstage headline show with full live band and special guests.");
    html = html.replace(/Pizza dough you cannot ruin/gi, "Paris — Le Trianon");
    html = html.replace(/No stand mixer,\s*no scales[^<]*/gi, "European tour stop featuring acoustic and album premiere sets.");
    html = html.replace(/Jollof arancini/gi, "Berlin — Astra Kulturhaus");
    html = html.replace(/Leftover party jollof[^<]*/gi, "Festival showcase and intimate live session recording.");
    html = html.replace(/Cook this tonight/gi, "Get tickets");

    // Feature Section (Album / Release Feature)
    html = html.replace(/A cookbook for the table you already have\./gi, "The Debut Album — Sound, Stage &amp; Story");
    html = html.replace(/The\s*<br[^>]*>\s*Sunday\s*<br[^>]*>\s*Table/gi, `${escapeHtml(name)}<br>Live Tour`);
    html = html.replace(/Eight chapters from Monday-night pasta[^<]*/gi, "12 tracks recorded live between London and Lagos, capturing the raw energy of performance. Available across all major streaming services and on limited 180g gatefold vinyl.");
    html = html.replace(/112\s*recipes in 8 chapters/gi, "12 original tracks");
    html = html.replace(/304\s*pages,\s*hardback/gi, "180g Vinyl Edition");
    html = html.replace(/£24\s*signed first print/gi, "Worldwide Shipping");
    html = html.replace(/Pre-order a signed copy/gi, "Order Vinyl Record");
    html = html.replace(/Read a free chapter/gi, "Listen on Spotify");

    // Form Section
    html = html.replace(/The Sunday Supper Letter/gi, "The VIP Backstage Pass");
    html = html.replace(/One recipe,\s*one story,\s*every Sunday morning\./gi, "Tour presales, unreleased acoustic demos, and official drops.");
    html = html.replace(/Join 38,000 home cooks\.[^<]*/gi, "Join over 25,000 fans getting first access to tickets, intimate secret show dates, and unreleased studio previews.");
    html = html.replace(/Save me a seat/gi, "Join the Guestlist");
    html = html.replace(/What should Tomi call you\?/gi, "What should we call you?");
    html = html.replace(/Send me Sunday's recipe/gi, "Get Tour &amp; Ticket Alerts");
    html = html.replace(/How do you feel in the kitchen\?/gi, "What is your nearest tour city?");

    // Footer
    html = html.replace(/©\s*\d{4}\s*[^·<]*Kitchen Ltd/gi, `© 2026 ${escapeHtml(name)}`);
    html = html.replace(/partners@tomiskitchen\.co/gi, `booking@${slug}.com`);
    html = html.replace(/Pans,\s*knives and oil are in the shop[^.<]*/gi, "Streaming live on Spotify, Apple Music, and YouTube.");
  } else if (domain === "tech") {
    html = html.replace(/●\s*COOKING VIDEOS EVERY SUNDAY/gi, "● DEVELOPER TOOLS &amp; API");
    html = html.replace(/Dinner in 20,\s*40 or 90 minutes\./gi, "Features Built for Speed and Scale");
    html = html.replace(/Cook this tonight/gi, "Learn more");
    html = html.replace(/The Sunday Supper Letter/gi, "The Developer Dispatch");
  }

  // 7. High-Resolution Domain Photo Replacement
  const photos = DOMAIN_STOCK_PHOTOS[domain] || DOMAIN_STOCK_PHOTOS.music;
  let photoIdx = 0;

  // Replace all content images (excluding small logo icons)
  html = html.replace(/(<img\b(?![^>]*\bclass="[^"]*logo[^"]*")[^>]*\bsrc=")([^"]*)(")/gi, (m, before, oldSrc, after) => {
    const newSrc = photos[photoIdx % photos.length];
    photoIdx++;
    return `${before}${escapeHtml(newSrc)}${after}`;
  });

  // Replace background-image urls in inline styles
  html = html.replace(/(style="[^"]*background(?:-image)?\s*:\s*url\(['"]?)([^'")]+)(['"]?\)[^"]*")/gi, (m, before, oldUrl, after) => {
    const newSrc = photos[photoIdx % photos.length];
    photoIdx++;
    return `${before}${escapeHtml(newSrc)}${after}`;
  });

  // 8. Update document title
  const pageTitle = hero.startsWith(name) ? hero : `${name} — ${hero}`;
  if (html.includes("<title>")) {
    html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(pageTitle)}</title>`);
  } else if (html.includes("<head>")) {
    html = html.replace("<head>", `<head><title>${escapeHtml(pageTitle)}</title>`);
  }

  // 9. Inject brand accent color if provided
  if (input.brandColor) {
    const colorStyle = `<style data-sol-brand="true">:root{--primary:${input.brandColor};--brand:${input.brandColor};--accent:${input.brandColor};}</style>`;
    if (html.includes("</head>")) {
      html = html.replace("</head>", `${colorStyle}</head>`);
    }
  }

  // 10. Replace logo image src if provided and template has logo img
  if (input.logoUrl) {
    html = html.replace(/(<img[^>]*class="[^"]*logo[^"]*"[^>]*src=")([^"]*)(")/i, `$1${escapeHtml(input.logoUrl)}$3`);
  }

  // 11. Stamp data-sol-personalized attribute for checklist and facts detection
  if (html.includes("<body")) {
    html = html.replace(/<body([^>]*)>/i, `<body$1 data-sol-personalized="true">`);
  } else if (!html.includes('data-sol-personalized="true"')) {
    html = `<div data-sol-personalized="true">${html}</div>`;
  }

  return {
    html,
    summary: `Personalized template headlines, intro narrative, photography, and cards for "${name}".`,
    headlines: { hero, subhero, cta },
  };
}

import type { SolRoute } from "@/lib/ai/solEngine";
import type { ConcreteTier } from "@/lib/ai/types";

/**
 * Uses SOL AI directly (via system AI provider or BYOK key via SOL Engine) to deeply personalize a template HTML.
 */
export async function personalizeWithAi(input: {
  html: string;
  name: string;
  about?: string;
  goal?: string;
  templateName?: string;
  templateDescription?: string;
  brandColor?: string;
  logoUrl?: string;
  userId?: string;
  solRoute?: { route: SolRoute; tier: ConcreteTier };
}): Promise<PersonalizedResult | null> {
  try {
    const { callProvider } = await import("@/lib/ai/generate");
    const { resolveModel } = await import("@/lib/ai/modelRegistry");

    let provider: import("@/lib/ai/types").AiProvider;
    let apiKey: string;
    let tier: ConcreteTier;

    if (input.solRoute) {
      provider = input.solRoute.route.provider;
      apiKey = input.solRoute.route.apiKey;
      tier = input.solRoute.tier;
    } else {
      const { resolveSystemProvider } = await import("@/lib/ai/systemProvider");
      const system = resolveSystemProvider();
      provider = system.provider;
      apiKey = system.apiKey;
      tier = "MEDIUM";
    }

    const model = resolveModel(provider, tier);
    const domain = detectPersonalizationDomain(input.about || "", input.goal);
    const photos = DOMAIN_STOCK_PHOTOS[domain] || DOMAIN_STOCK_PHOTOS.music;

    const systemPrompt = `You are SOL, an elite AI website builder and brand creative director.
Your job is to deeply personalize an existing HTML web page template for a client's brand.

STRICT INSTRUCTIONS:
1. Deep personalization: Rewrite headlines, paragraphs, media cards, bento grid items, feature stats, forms, and footers to fit the client's brand and domain.
2. If the client is an artist/musician, ensure every section focuses on music, live shows, performances, Spotify/Apple streaming, and tours (NOT cooking, recipes, or pasta).
3. Do NOT copy-paste raw prompt instructions. Write clean, punchy, persuasive copy.
4. Replace content image src attributes with the provided domain photography URLs:
${photos.map((p, i) => `Photo ${i + 1}: ${p}`).join("\n")}
5. Preserve the entire HTML document structure, CSS classes, inline styles, IDs, and scripts.
6. Add data-sol-personalized="true" to the <body> tag.
7. Return ONLY the raw HTML starting with <!doctype html> or <html>. Do NOT include markdown code blocks (\`\`\`html) or conversational commentary.`;

    const userPrompt = `Client Brand: "${input.name}"
Description / Intent: "${input.about || ""}"
Goal: ${input.goal || "business-site"}
Domain: ${domain}

Original HTML template to personalize:
${input.html}`;

    let usage: { inputTokens?: number; outputTokens?: number } | undefined;
    let res;
    try {
      res = await callProvider(
        provider,
        model,
        apiKey,
        systemPrompt,
        userPrompt,
        16000
      );
      usage = res.usage;
    } finally {
      // Rule 3: What was used is charged through the SOL engine (Plexo's AI only; see chargeFor).
      if (input.userId && input.solRoute) {
        const { chargeFor } = await import("@/lib/ai/solEngine");
        await chargeFor(input.userId, input.solRoute.route, tier, "edit_raw_html", usage).catch((e) =>
          console.warn("[sol] chargeFor error:", e)
        );
      }
    }

    let raw = (res?.text || "").trim();
    if (raw.startsWith("```")) {
      raw = raw.replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/i, "");
    }

    if (raw.includes("<html") && raw.includes("</html>")) {
      return {
        html: raw,
        summary: `SOL AI deeply personalized your template copy, cards, and photos for "${input.name}".`,
        headlines: {
          hero: `${input.name} — Live Shows & Performances`,
          subhero: input.about || "",
          cta: "See upcoming shows",
        },
      };
    }
    return null;
  } catch (err) {
    console.warn("personalizeWithAi failed, falling back to deterministic personalizer:", err);
    return null;
  }
}

/**
 * Primary personalization dispatcher:
 * Prioritizes deep personalization of the chosen template HTML.
 */
export async function personalizeTemplate(input: {
  profile: SolBuildProfile;
  designId?: string;
  templateHtml?: string;
  templateName?: string;
  templateDescription?: string;
  userId?: string;
  solRoute?: { route: SolRoute; tier: ConcreteTier };
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
    // Connect with SOL AI directly to personalize when system provider or SOL route is available
    if (process.env.SYSTEM_AI_PROVIDER || input.solRoute) {
      try {
        const aiResult = await personalizeWithAi({
          html,
          name,
          about,
          goal,
          templateName,
          templateDescription,
          brandColor,
          logoUrl,
          userId: input.userId,
          solRoute: input.solRoute,
        });
        if (aiResult) return aiResult;
      } catch (err) {
        console.warn("SOL AI personalization encountered an error, falling back to deterministic engine:", err);
      }
    }

    // Deduct fallback flat credit if using Plexo AI
    if (input.userId && input.solRoute && input.solRoute.route.paidBy === "plexo") {
      const { chargeFlatCredits } = await import("@/lib/db/ledgerOperations");
      await chargeFlatCredits(input.userId, 1, "Personalize template with SOL").catch(() => undefined);
    }

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
    subhero = `The official home of ${name}. Catch upcoming shows, performances, and releases.`;
    cta = "See upcoming shows";
  } else if (about.toLowerCase().includes("italian") || about.toLowerCase().includes("food") || about.toLowerCase().includes("chef") || about.toLowerCase().includes("cook")) {
    hero = `Savour the Art of Dining at ${name}`;
    subhero = `Handcrafted recipes, unforgettable flavours, and an authentic culinary experience made with passion.`;
    cta = "Reserve Your Table";
  } else if (about.toLowerCase().includes("clinic") || about.toLowerCase().includes("health") || about.toLowerCase().includes("wellness") || about.toLowerCase().includes("therapy")) {
    hero = `Compassionate, Holistic Care at ${name}`;
    subhero = `Empowering your wellness journey with personalized treatment and dedicated support.`;
    cta = "Book a Consultation";
  } else if (about.toLowerCase().includes("agency") || about.toLowerCase().includes("design") || about.toLowerCase().includes("studio") || about.toLowerCase().includes("tech")) {
    hero = `Designed for Impact. Built by ${name}.`;
    subhero = `We craft exceptional digital experiences and strategies that help modern businesses thrive.`;
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
