// Creative direction and the prompt block that makes SOL build with it. Pure: takes the brief from
// lib/ai/solBrief.ts and returns (1) a plain-words creative direction scaffold and (2) the short
// block added to SOL's system prompt for a new build. The model fills in the specific words; this
// fixes the structure, the quality bar and the facts it must not lose.

import { brandPromptBlock } from "@/lib/brand/brandModel";
import { askArgsFor, parseBrief, planQuestions, type Brief, type BriefAttachment, type KnownBrand, type PageGoal, type PlannedQuestion, type QuestionPlan } from "./solBrief";
import type { SolBuildProfile } from "./solBuildContext";
import { NEW_SITE_LABEL, SITE_QUESTION, SITE_TOUCH_RE, addToLabel, displayName, newOrAddQuestion, resolveSite, type OwnerSite, type SiteResolution } from "./solSiteResolution";
import { extractName } from "./solBrief";

type Palette = { name: string; primary: string; secondary: string; background: string; surface: string; text: string; accent: string };

/** Contrast-checked (text on background and on surface >= 4.5:1; see tests). */
export const PALETTES: Record<string, Palette> = {
  warm: { name: "Warm and friendly", primary: "#C2410C", secondary: "#7C2D12", background: "#FFF8F1", surface: "#FFEEDB", text: "#2B1A10", accent: "#F59E0B" },
  bold: { name: "Bold and modern", primary: "#4F46E5", secondary: "#111827", background: "#FFFFFF", surface: "#F3F4F6", text: "#111827", accent: "#F43F5E" },
  calm: { name: "Calm and clean", primary: "#0F766E", secondary: "#134E4A", background: "#FAFAF9", surface: "#EEF4F3", text: "#1C2B2A", accent: "#D97706" },
  elegant: { name: "Elegant and premium", primary: "#1F2937", secondary: "#8A6A2F", background: "#FBFAF7", surface: "#F1EDE4", text: "#1B1B1B", accent: "#B8924A" },
  playful: { name: "Playful and bright", primary: "#DB2777", secondary: "#831843", background: "#FFFDF7", surface: "#FFF0F7", text: "#26203A", accent: "#0EA5E9" },
  fresh: { name: "Fresh and natural", primary: "#15803D", secondary: "#14532D", background: "#F8FBF6", surface: "#EAF4E4", text: "#16241A", accent: "#CA8A04" },
};

const FONT_PAIRS: Record<string, { heading: string; body: string; feel: string }> = {
  warm: { heading: "Fraunces", body: "Inter", feel: "a soft serif for headlines with a clean sans for reading" },
  bold: { heading: "Space Grotesk", body: "Inter", feel: "a confident geometric sans, big and tight" },
  calm: { heading: "DM Sans", body: "DM Sans", feel: "one quiet, even sans with lots of space" },
  elegant: { heading: "Playfair Display", body: "Inter", feel: "a refined serif with light, airy body text" },
  playful: { heading: "Poppins", body: "Inter", feel: "rounded, friendly headlines" },
  fresh: { heading: "DM Serif Display", body: "DM Sans", feel: "an organic serif with a friendly sans" },
};

export function paletteKeyForTone(tone: string | undefined, industry: string | undefined): keyof typeof PALETTES {
  const t = `${tone ?? ""} ${industry ?? ""}`.toLowerCase();
  if (/elegant|luxur|premium|refined|sophisticated|classic|law/.test(t)) return "elegant";
  if (/playful|fun|youthful|cheerful|vibrant/.test(t)) return "playful";
  if (/bold|modern|edgy|sleek|energetic|software|agency|dark/.test(t)) return "bold";
  if (/calm|clean|minimal|gentle|soothing|wellness|health|spa/.test(t)) return "calm";
  if (/natural|rustic|fresh|green|garden|organic|travel/.test(t)) return "fresh";
  return "warm";
}

export type DirectionSection = { section: string; job: string };

const PLANS: Record<PageGoal, DirectionSection[]> = {
  landing: [
    { section: "hero", job: "Say the promise in one line and give one primary button" },
    { section: "proof strip", job: "Logos, a number or a short quote right under the hero so trust starts early" },
    { section: "how it works / offer", job: "Three plain steps or what exactly they get" },
    { section: "benefits", job: "Outcomes for the visitor, not features, each with a one-line proof" },
    { section: "testimonials", job: "Two or three believable quotes (marked as samples until real ones are added)" },
    { section: "pricing or packages", job: "Remove the 'how much?' doubt; highlight the best-value option" },
    { section: "FAQ", job: "Answer the three objections that stop people buying" },
    { section: "final CTA", job: "Repeat the promise and the same primary button" },
    { section: "footer", job: "Name, contact details, links and the legal basics" },
  ],
  "business-site": [
    { section: "home hero", job: "What you do, for whom, and the one next step" },
    { section: "services", job: "What you offer, each with the result the customer gets" },
    { section: "about", job: "The people and the reason the business exists" },
    { section: "testimonials", job: "Real-sounding proof from customers like them" },
    { section: "contact", job: "Form, phone, address and hours with a clear call to action" },
  ],
  store: [
    { section: "hero", job: "The best-seller or the offer, with a shop button" },
    { section: "products", job: "A grid of real-named products with prices" },
    { section: "why us", job: "Quality, delivery and returns in three lines" },
    { section: "reviews", job: "Buyer proof (marked as samples until real)" },
    { section: "FAQ", job: "Shipping, returns, payments" },
    { section: "final CTA + footer", job: "Shop again, newsletter, contact" },
  ],
  blog: [{ section: "hero", job: "What the blog is about and who it helps" }, { section: "latest posts", job: "Three real first posts" }, { section: "subscribe", job: "A newsletter sign-up" }],
  course: [
    { section: "hero", job: "The transformation promised and a Join button" },
    { section: "who it's for", job: "The learner and their problem" },
    { section: "what you'll learn", job: "Modules as outcomes" },
    { section: "instructor", job: "Why they should trust you" },
    { section: "testimonials", job: "Results from learners (marked as samples)" },
    { section: "pricing + guarantee", job: "One clear offer" },
    { section: "FAQ + final CTA", job: "Objections, then the same button" },
  ],
  "link-in-bio": [{ section: "profile", job: "Name, one-line bio, logo or photo" }, { section: "links", job: "The 4-6 things people want, most important first" }, { section: "socials", job: "Icons for each channel" }],
  portfolio: [{ section: "hero", job: "Who you are and what you make" }, { section: "selected work", job: "Six best projects with a line each" }, { section: "about", job: "A short story" }, { section: "contact", job: "How to hire you" }],
  event: [{ section: "hero", job: "Name, date, place and an RSVP button" }, { section: "programme", job: "What happens, when" }, { section: "speakers or hosts", job: "Who is there" }, { section: "venue", job: "Map and directions" }, { section: "RSVP + FAQ", job: "Sign-up form and practical answers" }],
  app: [{ section: "hero", job: "What the app does and a Sign up button" }, { section: "features", job: "Three things it does best" }, { section: "pricing", job: "Plans" }, { section: "FAQ + CTA", job: "Objections, then sign up" }],
  other: [{ section: "hero", job: "The promise and one primary button" }, { section: "details", job: "What they get" }, { section: "proof", job: "Why trust it" }, { section: "contact", job: "The next step" }],
};

export type CreativeDirection = {
  positioning: string;
  voice: string;
  palette: { source: "brand" | "chosen"; name: string; roles: Array<{ role: string; value: string }> };
  typography: { heading: string; body: string; feel: string };
  imagery: string;
  logo: string;
  sectionPlan: DirectionSection[];
  copyRules: string[];
};

const IMAGERY: Record<string, string> = {
  bakery: "close, warm photos of the real products, hands at work, natural light",
  restaurant: "appetising close-ups of dishes and the room, never generic cutlery stock",
  "salon & beauty": "real results and calm studio details, soft light",
  fitness: "people mid-movement, honest effort, strong contrast",
  "law firm": "composed portraits and quiet office details, no gavels or scales clip-art",
  "health & wellness": "calm, natural light, real people and spaces, nothing clinical-cold",
  software: "crisp product screenshots and simple diagrams",
  agency: "case-study visuals and bold type treatments",
  photographer: "the work itself, large, with minimal chrome",
  fashion: "editorial product shots, texture close-ups",
  education: "learners in action, the instructor, before and after results",
  charity: "real people and places the cause helps, with dignity",
  "real estate": "bright wide interior shots, neighbourhood details",
  events: "atmosphere, crowds, the venue, people laughing",
  "home services": "before and after, the team on the job",
  travel: "wide landscapes and small human moments",
  "creative portfolio": "the work, large",
};

/** The creative direction as a scaffold; the model replaces every hint with specific words for THIS business. */
export function creativeDirection(b: Brief): CreativeDirection {
  const goal: PageGoal = b.goal.value ?? "landing";
  const tone = b.tone.value;
  const key = paletteKeyForTone(tone, b.industry.value);
  const p = PALETTES[key];
  const brandColors = b.colors.status === "known" || (b.colors.status === "inferred" && b.colors.source === "logo") ? (b.colors.value ?? []).filter((c) => /^#[0-9A-F]{6}$/i.test(c)) : [];
  const fromBrand = brandColors.length > 0;
  // The owner's colours by what they can do: very light ones are backgrounds, very dark ones are text.
  const lumOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).reduce((a, v, i) => a + [0.2126, 0.7152, 0.0722][i] * (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4), 0);
  const light = brandColors.find((c) => lumOf(c) > 0.8);
  const dark = brandColors.find((c) => lumOf(c) < 0.05);
  const mids = brandColors.filter((c) => c !== light && c !== dark);
  const roles = fromBrand
    ? [
        { role: "primary (buttons, links)", value: mids[0] ?? brandColors[0] },
        ...(mids[1] ? [{ role: "secondary (accents, highlights)", value: mids[1] }] : []),
        { role: "background", value: light ?? p.background },
        { role: "text (keep contrast 4.5:1 or better)", value: dark ?? p.text },
      ]
    : [
        { role: "primary (buttons, links)", value: p.primary },
        { role: "secondary", value: p.secondary },
        { role: "accent (small highlights only)", value: p.accent },
        { role: "background", value: p.background },
        { role: "soft sections", value: p.surface },
        { role: "text", value: p.text },
      ];
  const name = b.name.value && b.name.status !== "inferred" ? b.name.value : "the business";
  return {
    positioning: `One line that says what ${name} does, for whom, and why it is the better choice${b.audience.value ? ` (for ${b.audience.value})` : ""}.`,
    voice: tone ? `${tone}: write the way the owner would speak to a good customer.` : "Match the business: plain, warm and specific, the way the owner would speak to a good customer.",
    palette: { source: fromBrand ? "brand" : "chosen", name: fromBrand ? "Your brand colours" : p.name, roles },
    typography: b.fonts.value ? { heading: b.fonts.value.split(" + ")[0], body: b.fonts.value.split(" + ")[1] ?? b.fonts.value.split(" + ")[0], feel: "the fonts the owner asked for" } : FONT_PAIRS[key],
    imagery: (b.industry.value && IMAGERY[b.industry.value]) || "real, specific photos of the product, people or place; never generic handshake or laptop stock",
    logo:
      b.logo.value === "uploaded" || b.logo.value === "link"
        ? "Use the owner's logo in the header and footer; take the palette from it."
        : b.logo.value === "none" || b.logo.status === "missing"
          ? "No logo: set the business name as a clean wordmark (the brand heading font, tight spacing, one accent colour). Never leave an empty image slot."
          : "The owner will attach a logo: use it once it arrives; until then set the name as a wordmark.",
    sectionPlan: b.sections.status === "known" && (b.sections.value?.length ?? 0) >= 3 ? (b.sections.value ?? []).map((s) => ({ section: s, job: "As the owner asked, with real copy" })) : PLANS[goal],
    copyRules: [
      "Headline = the promise to the visitor in under 10 words, never the business name or 'Welcome to ...'.",
      "Every button says what happens next ('Book my free tasting'), one primary action per page.",
      "Benefits are outcomes with a concrete detail (a number, a place, a time), not adjectives.",
      "Testimonials, prices and stats the owner did not give you are plausible samples and are labelled 'sample' so they are replaced before going live.",
      "Write FAQs from real objections: price, time, trust, what happens next.",
    ],
  };
}

/** The direction as short plain words, the way SOL tells the owner (no jargon). */
export function directionSummary(d: CreativeDirection): string {
  const colors = d.palette.roles.slice(0, 3).map((r) => r.value).join(", ");
  return [
    `Positioning: ${d.positioning}`,
    `Voice: ${d.voice}`,
    `Colours: ${d.palette.name} (${colors})`,
    `Type: ${d.typography.heading} + ${d.typography.body}, ${d.typography.feel}`,
    `Pictures: ${d.imagery}`,
    `Logo: ${d.logo}`,
    `Sections: ${d.sectionPlan.map((s) => `${s.section} (${s.job})`).join("; ")}`,
  ].join("\n");
}

/** The quality bar, kept short on purpose: it is sent on every turn. */
export const QUALITY_BAR = `## The quality bar for anything you build

A new page is a designed, finished page, not a skeleton: 6 to 9 purposeful sections (hero with a clear promise and ONE primary button; proof near the top; how it works or the offer; benefits; pricing or products where it fits; FAQ; a final call to action; a footer with real contact details), strong hierarchy, the brand's colours and logo (or a clean wordmark), pictures that suit the industry, readable on a phone, accessible contrast, a search title and description, and a working form wherever people are asked to get in touch or book.

Make it distinctive, not templated: pick a layout and mood that suits THIS industry (a bakery is warm and photographic, a law firm is quiet and typographic, a SaaS is crisp and product-led); one strong typographic hierarchy (a big confident headline, calm body text, 2 fonts at most); generous whitespace and one steady section spacing; social proof with structure (a number, a quote, a name and place); motion kept to one or two gentle effects. When the owner gave a structure (sections in an order), follow it exactly, in their order, with their words.

Bland vs. good:
- Bland: headline "Welcome to Our Website", "We offer quality services", three cards titled "Service 1/2/3", "Contact us" as the only button.
- Good: "Cakes baked fresh for your Saturday, delivered across Accra", cards named after real products with a price and one line each, a button that says "Order a cake for this weekend", a FAQ answering "How early should I order?".
Never lorem ipsum, never "Your brand", never a hero that is just the name. When the owner gave copy, prices, links or contact details, use them word for word.

## The quality check (enforced, not optional)

Every time you build or edit a page, the result comes back with a "qualityCheck" note. It lists MUST FIX items (placeholder or sample wording, an empty grey image slot, unreadable text colours, dead links, a missing h1, no call to action, a form with nowhere to go, no search description, the owner's brand not applied ...). Fix every MUST item with page_edit (or site_create content) right away; the page is checked again after each change, up to 3 rounds. You will not be allowed to finish while a MUST item is open. Never tell the owner the checks exist or quote scores. When it passes: say in a few plain lines what you built (the feel, colours, pages and what each section is for), then offer 2 or 3 meaningful next improvements (for example: add their real photos, publish it, add a booking form). If something genuinely can't be fixed, say so in one plain sentence.`;

function factLines(b: Brief): string[] {
  const out: string[] = [];
  const line = (label: string, f: { status: string; value?: unknown; source?: string }) => {
    if (f.status === "missing" || f.value === undefined) return;
    const v = Array.isArray(f.value) ? (f.value as string[]).join(", ") : String(f.value);
    const where = f.source === "site" ? "from their site's brand" : f.source === "account" ? "from their account" : f.source === "answer" ? "they answered" : f.source === "logo" ? "read from their logo" : f.status === "inferred" ? "my inference, change if wrong" : "they said";
    out.push(`- ${label}: ${v} (${where})`);
  };
  line("Business name", b.name);
  line("What they do", b.offer);
  line("Industry", b.industry);
  line("Audience", b.audience);
  line("Main action", b.cta);
  line("Feel", b.tone);
  line("Colours", b.colors);
  if (b.logo.status !== "missing") out.push(`- Logo: ${{ uploaded: "they have one on file or attached (use_attached_image gives a public address for an attachment)", link: "they pasted a link to it", "will-send": "they will attach it", none: "none: design a wordmark" }[b.logo.value!]}`);
  line("Fonts", b.fonts);
  line("Sections wanted", b.sections);
  line("Language", b.language);
  const c = b.content;
  if (c.headlines.length) out.push(`- Their own copy to use word for word: ${c.headlines.map((h) => `"${h}"`).join(" | ")}`);
  if (c.emails.length) out.push(`- Emails: ${c.emails.join(", ")}`);
  if (c.phones.length) out.push(`- Phones: ${c.phones.join(", ")}`);
  if (c.urls.length) out.push(`- Links: ${c.urls.join(", ")}`);
  if (c.socials.length) out.push(`- Social: ${c.socials.join(", ")}`);
  if (c.prices.length) out.push(`- Prices they gave: ${c.prices.join(", ")}`);
  if (c.hasPhotos) out.push("- They have their own photos: ask for or use the attached ones; never swap in stock.");
  for (const k of b.constraints) out.push(`- Constraint: ${k}`);
  return out;
}

/**
 * The block added to the system prompt for a NEW build (empty for changes to existing pages).
 * It either hands SOL the exact intake card to show, or the creative direction to build with.
 */
export function discoveryPrompt(b: Brief, plan: QuestionPlan, site?: SiteResolution): string {
  const siteBlock = site ? siteResolutionPrompt(site, plan) : "";
  if (!b.isNewBuild) return plan.mode === "ask" && siteBlock ? `${siteBlock}\n\n${askBlock(plan)}` : siteBlock;
  const facts = factLines(b);
  const parts: string[] = ["## This request: what you know and what to do first"];
  parts.push(`How much they told you: ${b.richness.level} (${b.richness.score}/10).`);
  if (facts.length) parts.push(`What you already know (never ask for these; use every one):\n${facts.join("\n")}`);
  if (plan.understood) parts.push(`Open with this one line, in your own words: "${plan.understood}"`);

  if (siteBlock) parts.splice(1, 0, siteBlock);
  if (plan.mode === "ask") {
    parts.push(askBlock(plan));
    parts.push("When the answers arrive, go straight on: show the creative direction below in a few plain lines, then build in the same turn.");
  } else {
    const why = plan.reason === "skip" ? "They told you to just build it" : plan.reason === "already-asked" ? "You already asked your questions" : "They told you enough";
    parts.push(`${why}: do not ask a question round. Show the creative direction in a few plain lines, then build in the same turn.`);
    if (plan.assumptions.length) parts.push(`Where you weren't told, decide, and say so in ONE line after building ("I assumed: ..."):\n${plan.assumptions.map((a) => `- ${a}`).join("\n")}`);
  }

  const d = creativeDirection(b);
  parts.push(`## Creative direction (form this BEFORE building; replace each hint with specific words for this business, then pass it to the build tool)\n${directionSummary(d)}\nCopy rules:\n${d.copyRules.map((r) => `- ${r}`).join("\n")}`);
  parts.push("Tell the owner the direction in 4 to 6 plain lines (what it will feel like, the colours, the pages and their jobs), not as a table or in tool words.");
  if (b.logo.value === "uploaded" && b.logo.source === "logo") parts.push("They attached a logo: look at it, read its two main colours as hex values, use them as the palette and put the logo in the header (use_attached_image gives its public address).");
  if (b.logo.value === "none") parts.push("They have no logo: design the name as a clean wordmark in the header and footer. Never leave a broken or empty image slot.");
  if (b.language.value && b.language.value !== "English") parts.push(`Write the page copy and your replies in ${b.language.value}${plan.mode === "ask" ? ", and ask the questions and options in that language too" : ""}.`);
  return parts.join("\n\n");
}

/**
 * The standing brand rules, in the system prompt on every turn. The per-site brand itself (colours with roles, fonts, logo, whether it
 * is linked to Strata) arrives as the "This site's brand" block, resolved by lib/brand/resolveSiteBrand.ts, so it is fresh every turn.
 */
export const BRAND_RULES_GUIDE = `## The owner's brand (applied on every change, without being asked)
When a "This site's brand" block is in this prompt, that IS the owner's brand for that site. Use it on everything you build or change for the site, whatever it is made with (visual pages, classic pages, uploaded HTML, an app, an email, a blog or store layout, a funnel or course page), in the very first version and on every later change, without the owner ever mentioning it. Say plainly once, near the start, "I'll use your <brand name> brand." Never ask for their colours, fonts or logo while it exists. If a page you made isn't using it, fix that yourself. A change published in Strata shows up in that block on the next turn: always use what the block says now, not what you used earlier. You can read it any time with get_site_brand.
READY-MADE COMPONENTS: the brand lives in Strata, and its components (buttons, cards...) are listed in the brand block when it has any. Use them before inventing your own: on a page or in HTML, an element with class plx-brand-<name> (plus plx-brand-<name>--<look> for a variant) gets the brand's own design from the brand sheet; say plainly once "I'll use your brand's <name>". When you build something reusable that the brand doesn't have (a banner, a pricing card), offer once to save it to the brand with create_brand_component, so it is in Strata and everything can use it. Read the brand's variables with get_brand_tokens, and change its colours, fonts, corners or spacing with set_brand_tokens only when the owner asks. list_brand_components shows the current list.
A NEW website with no brand yet: if the owner hasn't given colours or a logo, call list_strata_projects once. If they have projects, offer them with ask_user_question ("Use one of your Strata brands?" with the project names, plus "No, choose for me") and pass the choice to site_create as strataProjectId. If they aren't connected to Strata or have none, don't mention Strata, just choose a brand to suit the business. For an existing site with no linked brand, you may offer once to connect one (link_site_brand) or to keep the one they have in Strata (create_strata_project_from_brand), and never push it.
APPS WITH THEIR OWN CODE (hosted server apps): when you create or edit such an app for a site with a linked brand, write its styles with the brand's variables (var(--color-brand-primary-500), var(--color-text-primary), var(--color-bg-canvas), var(--font-family-heading), var(--font-family-body), var(--radius-md)) instead of fixed colours or fonts, and keep <link rel=\"stylesheet\" href=\"/__plexo/brand/<site id>.css\"> in the app's shared layout or HTML shell. The owner can also switch on \"Add my brand to my app\" (Brand tab) so Plexo adds that link to the pages it serves; the link is never added twice, and <meta name=\"plexo-brand\" content=\"off\"> keeps a page out. Don't ask the owner to do any of this.`;

/** Offer to save new brand facts (colours, no-logo) to the site's brand, in the owner's words. */
export const SAVE_BRAND_GUIDE =
  "When you learn colours or a logo choice in chat that the site's brand doesn't hold yet, and you've built or are about to build with them, ask once with ask_user_question: \"Want me to save these as your brand for every page on this site?\" (Yes, save them / Not now). On yes, call site_save_look with the site's id, the colours and (if they said they have none) noLogo true, or the public logo address. Then tell them in one line it's saved and applied. Don't ask again if they decline.";


function askBlock(plan: QuestionPlan): string {
  return `Your FIRST action is one ask_user_question call with exactly these questions, in this order, nothing added or removed (the card already offers typing their own answer, "Skip, you choose" and "Just build it"). Do not write a plan, look at any site, or build anything until they answer. If the card can't be shown, ask the same questions in one short plain message instead:\n\`\`\`json\n${JSON.stringify(askArgsFor(plan))}\n\`\`\`\nAnything in those answers that says "Skip, you choose" or "Just build it" means: decide it yourself. Do not ask a second round.`;
}

/** Which site this is about, in words the model obeys. Never guesses, never borrows another site's brand. */
export function siteResolutionPrompt(site: SiteResolution, plan: QuestionPlan): string {
  const head = "## Which site this is about";
  switch (site.kind) {
    case "none":
      return `${head}\nThe owner has no site yet: this is a new one. Don't edit anything that exists.`;
    case "new":
      return `${head}\nThis is a NEW website. Don't edit, describe or take colours, logo or wording from any of their existing sites.`;
    case "use":
      return `${head}\nWork on the site "${displayName(site.site)}" (site id ${site.site.id}); pass that id to the page and site tools. ${site.announce ? `Start by saying "I'll work on ${displayName(site.site)}." in your own words, once. ` : ""}Use only this site's own brand; never another site's colours, logo or wording.${(() => { const b = brandPromptBlock(site.site.resolvedBrand, displayName(site.site)); return b ? `\n\n${b}` : ""; })()}`;
    case "ask-which":
      return `${head}\nThe owner has ${site.options.length - 1} websites and hasn't said which one this is about, so you don't know. Do not guess and do not use the most recent one. ${plan.mode === "ask" ? "" : "Ask: "}"${SITE_QUESTION}" with their sites by name and "${NEW_SITE_LABEL}" as the choices (in the card). Until they answer, don't read, change or take brand details from any site. After they answer, say "I'll work on <site>." once. Never ask again in this conversation.`;
    case "ask-new-or-add":
      return `${head}\nThey're working on "${displayName(site.site)}" but this request looks like a different business. Don't assume: ask "${newOrAddQuestion(displayName(site.site))}" (${NEW_SITE_LABEL} / ${addToLabel(displayName(site.site))}) first. For a new website use nothing from "${displayName(site.site)}"'s brand.`;
    case "unresolved":
      return `${head}\nThey answered which site, but it doesn't match one of their sites. Say in one plain sentence which site you understood and check it before changing anything. Don't take any site's brand until it's clear.`;
  }
}

// ---------------------------------------------------------------- from the conversation

type HistoryLike = { role: "user" | "assistant"; content: any };
const BUILD_TOOLS = new Set(["site_create", "page_create_from_template", "create_landing_page", "create_raw_landing_page", "create_site_from_template", "create_app", "create_funnel"]);

const blocksOf = (content: unknown): any[] => (Array.isArray(content) ? content : typeof content === "string" ? [{ type: "text", text: content }] : []);

function parseAnswers(content: string): Array<{ question: string; answer: string }> {
  const out: Array<{ question: string; answer: string }> = [];
  for (const chunk of content.split(/\n\n(?=Q: )/)) {
    const m = chunk.match(/^Q: ([\s\S]*?)\nA: ([\s\S]*)$/);
    if (m) out.push({ question: m[1].trim(), answer: m[2].trim() });
  }
  return out;
}

const siteQuestionFor = (res: SiteResolution): PlannedQuestion | undefined =>
  res.kind === "ask-which"
    ? { key: "site", header: "Your website", question: SITE_QUESTION, options: res.options }
    : res.kind === "ask-new-or-add"
      ? { key: "site", header: "New or existing", question: newOrAddQuestion(displayName(res.site)), options: [{ label: NEW_SITE_LABEL }, { label: addToLabel(displayName(res.site)) }] }
      : undefined;

/** The brief, which site it is about, and the question plan for the conversation so far (what SOL's system prompt is built from). */
export function briefFromConversation(history: HistoryLike[], profile?: SolBuildProfile) {
  const userTexts: string[] = [];
  const answers: Array<{ question: string; answer: string }> = [];
  const attachments: BriefAttachment[] = [];
  let alreadyBuilt = false;
  let alreadyAsked = false;
  for (const entry of history) {
    for (const b of blocksOf(entry.content)) {
      if (entry.role === "user" && b?.type === "text" && typeof b.text === "string" && !/^<attached_file /.test(b.text)) userTexts.push(b.text);
      else if (entry.role === "user" && b?.type === "image") attachments.push({ type: "image", url: b.source?.url, filename: b.filename });
      else if (entry.role === "user" && b?.type === "tool_result" && typeof b.content === "string") answers.push(...parseAnswers(b.content));
      else if (entry.role === "assistant" && b?.type === "tool_use") {
        if (b.name === "ask_user_question") alreadyAsked = true;
        if (BUILD_TOOLS.has(b.name)) alreadyBuilt = true;
      }
    }
  }
  const text = userTexts[userTexts.length - 1] ?? "";
  const sites: OwnerSite[] = profile?.sites ?? [];
  const account: KnownBrand & { goal?: string } = { ...(profile?.brand ?? {}), goal: profile?.goal };

  // First pass without any site brand: is this a new build, and which business does the message name?
  const probe = parseBrief({ text, priorUserTexts: userTexts.slice(0, -1), answers, account, attachments, alreadyBuilt, alreadyAsked });
  const named = extractName(text) ?? extractName(userTexts.join("\n"));
  const resolution = resolveSite({ sites, signal: profile?.siteSignal, answers, touchesExisting: !probe.isNewBuild || SITE_TOUCH_RE.test(text), namedBusiness: named, isNewBuild: probe.isNewBuild });

  // Only the chosen site's own brand ever reaches the brief.
  const used = resolution.kind === "use" ? resolution.site : undefined;
  const siteName = used?.name && displayName(used) !== "Untitled site" ? used.name.trim() : undefined;
  const siteBrand: KnownBrand | undefined = used?.brand || siteName ? { ...(used?.brand ?? {}), ...(siteName ? { name: siteName } : {}) } : undefined;
  const input = { text, priorUserTexts: userTexts.slice(0, -1), answers, account, site: siteBrand, attachments, alreadyBuilt, alreadyAsked };
  const brief = parseBrief(input);
  let plan = planQuestions(brief, input);

  const siteQ = siteQuestionFor(resolution);
  if (siteQ) {
    plan = brief.isNewBuild && plan.mode === "ask" ? { ...plan, questions: [siteQ, ...plan.questions] } : { ...plan, mode: "ask", questions: [siteQ], reason: "ask" };
  }
  return { brief, plan, resolution, siteId: used?.id };
}
