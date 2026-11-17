// SOL's brief intake. Pure (no database, no model): turns what the owner typed, what the account
// and the current site already know, and the answers they have given into ONE structured creative
// brief, then plans the few questions worth asking before anything is built.
//
// Principles (docs/SOL_DISCOVERY.md): never discard a detail the owner gave; never ask what is
// already known; a rich brief asks (almost) nothing; a thin one asks a short, ordered set with a
// "you choose" escape. Every field records where it came from.

export type FieldStatus = "known" | "inferred" | "missing";
export type FieldSource = "message" | "answer" | "account" | "site" | "logo" | "inferred" | "default";
export type Field<T> = { status: FieldStatus; value?: T; source?: FieldSource };

export type LogoState = "uploaded" | "link" | "will-send" | "none";
export type PageGoal = "landing" | "business-site" | "store" | "blog" | "course" | "link-in-bio" | "portfolio" | "event" | "app" | "other";

/** The brand facts known for the site being worked on (Template.brand + the account's onboarding brand). */
export type KnownBrand = {
  name?: string;
  about?: string;
  industry?: string;
  tone?: string;
  colors?: string[];
  logoUrl?: string;
  /** "I don't have a logo": a wordmark is made from the name. */
  noLogo?: boolean;
};

export type BriefAttachment = { type?: string; filename?: string; url?: string; /** Main colours read from a logo image (lib/onboarding/logoColors.ts dominantColors). */ colors?: string[] };

export type BriefInput = {
  /** The newest message from the owner. */
  text: string;
  /** Earlier messages from the owner in this conversation (oldest first). */
  priorUserTexts?: string[];
  /** Answers already given to SOL's questions, if any. */
  answers?: Array<{ question: string; answer: string }>;
  /** What the account (onboarding) and the current site already know. Site wins over account. */
  account?: KnownBrand & { goal?: string };
  site?: KnownBrand;
  attachments?: BriefAttachment[];
  /** SOL has already built something in this conversation, so this is a change, not a new build. */
  alreadyBuilt?: boolean;
  /** SOL has already asked its intake round in this conversation. */
  alreadyAsked?: boolean;
};

export type BriefContent = {
  headlines: string[];
  emails: string[];
  phones: string[];
  urls: string[];
  socials: string[];
  prices: string[];
  hasPhotos: boolean;
  hasTestimonials: boolean;
};

export type Brief = {
  isNewBuild: boolean;
  goal: Field<PageGoal>;
  name: Field<string>;
  offer: Field<string>;
  industry: Field<string>;
  audience: Field<string>;
  cta: Field<string>;
  tone: Field<string>;
  colors: Field<string[]>;
  logo: Field<LogoState>;
  fonts: Field<string>;
  sections: Field<string[]>;
  language: Field<string>;
  content: BriefContent;
  constraints: string[];
  /** "Just build it" / "surprise me": make sensible choices and state them. */
  skip: boolean;
  wordCount: number;
  richness: { score: number; level: "simple" | "medium" | "rich" };
};

const missing = <T,>(): Field<T> => ({ status: "missing" });
const known = <T,>(value: T, source: FieldSource): Field<T> => ({ status: "known", value, source });
const inferred = <T,>(value: T, source: FieldSource = "inferred"): Field<T> => ({ status: "inferred", value, source });

// ---------------------------------------------------------------- vocabulary

const COLOR_WORDS = [
  "navy", "forest green", "emerald", "olive", "mint", "teal", "turquoise", "aqua", "sky blue", "royal blue", "baby blue", "blue", "indigo", "violet", "purple", "lavender", "lilac", "magenta",
  "hot pink", "pink", "rose", "blush", "coral", "salmon", "peach", "red", "burgundy", "maroon", "crimson", "orange", "terracotta", "rust", "amber", "gold", "mustard", "yellow", "cream", "beige",
  "sand", "tan", "brown", "chocolate", "green", "charcoal", "black", "white", "grey", "gray", "silver", "bronze",
];
const TONE_WORDS = [
  "warm", "friendly", "bold", "modern", "calm", "elegant", "minimal", "minimalist", "playful", "luxurious", "luxury", "professional", "trustworthy", "premium", "fun", "energetic", "cosy", "cozy",
  "clean", "classic", "rustic", "edgy", "sleek", "youthful", "serious", "authoritative", "gentle", "natural", "refined", "vibrant", "casual", "sophisticated", "dark", "cheerful", "soothing",
];
const INDUSTRIES: Array<[string, RegExp]> = [
  ["bakery", /\b(bakery|bakeries|baker|cakes?|pastr(?:y|ies)|bread|boulangerie|panader[íi]a|padaria|b[äa]ckerei|panetteria)\b/i],
  ["restaurant", /\b(restaurant|cafe|café|coffee shop|bistro|catering|chef|takeaway|bar and grill)\b/i],
  ["salon & beauty", /\b(salon|barber|spa|beauty|makeup|nails?|hair stylist|skincare)\b/i],
  ["fitness", /\b(gym|fitness|personal trainer|yoga|pilates|crossfit|workout)\b/i],
  ["law firm", /\b(law firm|lawyer|attorney|solicitor|legal)\b/i],
  ["health & wellness", /\b(clinic|cl[íi]nica|clinique|dentist|dentista|dental|therapist|therapy|doctor|physio|wellness|counsell?ing|nutritionist)\b/i],
  ["software", /\b(saas|software|app|startup|platform|api|developer tool|ai tool)\b/i],
  ["agency", /\b(agency|consultancy|consulting|marketing|branding studio|design studio)\b/i],
  ["photographer", /\b(photograph(?:er|y)|videograph(?:er|y)|filmmaker)\b/i],
  ["fashion", /\b(boutique|fashion|clothing|apparel|jewell?ery|shoes|streetwear)\b/i],
  ["education", /\b(course|tutor|tutoring|school|academy|workshop|coach(?:ing)?|bootcamp|lessons?)\b/i],
  ["charity", /\b(charity|non-?profit|ngo|foundation|donat(?:e|ions?)|church|ministry)\b/i],
  ["real estate", /\b(real estate|realtor|property|estate agent|apartments?|rentals?)\b/i],
  ["events", /\b(wedding|event planner|events?|conference|festival|concert)\b/i],
  ["home services", /\b(plumb(?:er|ing)|electrician|cleaning|landscap(?:er|ing)|contractor|roofing|painter|handyman)\b/i],
  ["travel", /\b(travel|tours?|hotel|lodge|safari|airbnb|guesthouse)\b/i],
  ["creative portfolio", /\b(portfolio|illustrator|designer|artist|musician|writer)\b/i],
];
const SECTION_WORDS: Array<[string, RegExp]> = [
  ["hero", /\bhero\b/i], ["about", /\babout( us| me)?\b/i], ["services", /\bservices?\b/i], ["pricing", /\b(pricing|prices|plans|packages)\b/i],
  ["testimonials", /\b(testimonials?|reviews?|social proof)\b/i], ["faq", /\b(faqs?|frequently asked)\b/i], ["contact", /\bcontact( form| us)?\b/i],
  ["gallery", /\b(gallery|portfolio|our work|case studies)\b/i], ["team", /\b(team|our people|meet the)\b/i], ["blog", /\bblog\b/i],
  ["menu", /\bmenu\b/i], ["shop", /\b(shop|store|products?)\b/i], ["booking", /\b(booking|book online|appointments?|reservations?)\b/i],
  ["features", /\b(features|benefits)\b/i], ["how it works", /\bhow it works\b/i], ["newsletter", /\b(newsletter|subscribe form|mailing list)\b/i],
  ["stats", /\b(stats|numbers|by the numbers)\b/i], ["map", /\b(map|directions|location)\b/i], ["footer", /\bfooter\b/i],
];
const CTA_PATTERNS: Array<[string, RegExp]> = [
  ["Book a call or appointment", /\b(book(?:ing)?|appointments?|reserve|reservation|schedule a call|consultation)\b/i],
  ["Get a quote", /\b(get a quote|request a quote|quote)\b/i],
  ["Buy or order now", /\b(buy|purchase|order(?:ing)?|add to cart|checkout|place an order)\b/i],
  ["Sign up", /\b(sign[- ]?up|register|create an account|join the waitlist|waitlist|get started)\b/i],
  ["Subscribe", /\b(subscribe|newsletter|mailing list)\b/i],
  ["Donate", /\b(donate|donations|give now|support us)\b/i],
  ["Download", /\b(download|get the (?:ebook|guide|app))\b/i],
  ["Contact us", /\b(contact us|get in touch|enquir(?:e|y|ies)|call us|message us|whatsapp)\b/i],
  ["Visit us", /\b(visit us|walk[- ]?ins?|come (?:in|by)|find us)\b/i],
];
const SKIP_RE = /\b(just build it|surprise me|you (?:choose|decide|pick)|your call|up to you|skip(?: the)? questions|don'?t ask|no questions|use your (?:best )?judg(?:e)?ment|go ahead and build|decide for me)\b/i;
const NO_LOGO_RE = /\b(no logo|don'?t have (?:a )?logo|do not have (?:a )?logo|haven'?t (?:got|made) (?:a )?logo|without (?:a )?logo|no logo yet|make (?:me )?a (?:simple )?(?:wordmark|logo)|text logo)\b/i;
const HAS_LOGO_RE = /\b(my logo|our logo|attached (?:is )?(?:the |my |our )?logo|logo (?:is )?attached|i have (?:a )?logo|here'?s (?:the|my|our) logo|logo (?:file|below))\b/i;
const BUILD_VERB_RE = /\b(build|create|make|design|set up|setup|generate|need|want|put together|launch|start|write me|je veux|je voudrais|besoin|cr[ée]er?|quiero|necesito|crear|quero|preciso|criar|ich m[öo]chte|ich brauche|erstelle|voglio|ho bisogno|nataka)\b/i;
const PAGE_NOUN_RE = /\b(landing page|website|web site|site web|sitio web|site|web ?page|page|p[áa]gina|webseite|sito|tovuti|store|shop|online shop|blog|portfolio|link[- ]in[- ]bio|funnel|homepage|home page|app|web app)\b/i;
const PAGE_LEAD_RE = /^\s*(?:a |an |my |our |the )?(?:new )?(?:landing page|website|web site|site|web ?page|page|store|online store|online shop|blog|portfolio)\s+(?:for|about|to)\b/i;
const EDIT_START_RE = /^\s*(?:please\s+)?(?:can you\s+|could you\s+)?(change|update|fix|edit|rename|replace|swap|remove|delete|translate|publish|move|resize|rewrite|shorten|make (?:the|my|it|this)\b|add (?:a|an|the)\b)/i;

const STOP_NAME_WORDS = new Set(["my", "our", "a", "an", "the", "this", "that", "me", "us", "your", "i", "we", "it", "someone", "people", "business", "company", "brand", "shop", "store", "website", "site", "page", "landing", "new", "small"]);

// ---------------------------------------------------------------- small extractors

const uniq = <T,>(xs: T[]): T[] => Array.from(new Set(xs));
const clean = (s: string) => s.replace(/\s+/g, " ").trim().replace(/[.,;:!?]+$/, "");

export function extractHexColors(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    let h = m[1].toUpperCase();
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    out.push(`#${h}`);
  }
  return uniq(out);
}

export function extractColorWords(text: string): string[] {
  const lower = text.toLowerCase();
  const found: Array<{ w: string; at: number }> = [];
  for (const w of COLOR_WORDS) {
    const re = new RegExp(`\\b${w.replace(/ /g, "\\s+")}\\b`, "g");
    for (const m of lower.matchAll(re)) found.push({ w, at: m.index ?? 0 });
  }
  // drop a word that is part of a longer matched one at the same spot ("blue" inside "royal blue")
  const kept = found.filter((a) => !found.some((b) => b !== a && b.w.length > a.w.length && b.w.includes(a.w) && a.at >= b.at && a.at < b.at + b.w.length));
  return uniq(kept.sort((a, b) => a.at - b.at).map((f) => f.w));
}

/** Colour words only count as brand colours when the owner is talking about colours (not "a white-glove service"). */
function colourContext(text: string): boolean {
  return /\b(colou?rs?|palette|brand|theme|scheme|shades?|tones? of|accent|background|logo)\b/i.test(text) || /\b(in|with|using|use|plus|and)\s+(?:\w+\s+){0,2}(navy|forest green|emerald|teal|gold|blue|green|red|purple|pink|orange|yellow|black|white|brown|burgundy|coral|cream)\b/i.test(text);
}

export function extractContacts(text: string): { emails: string[]; phones: string[]; urls: string[]; socials: string[] } {
  const emails = uniq(Array.from(text.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g), (m) => m[0].toLowerCase()));
  const phones = uniq(Array.from(text.matchAll(/(?<![\w#])(\+?\d[\d\s().-]{7,17}\d)(?![\w])/g), (m) => clean(m[1])).filter((p) => p.replace(/\D/g, "").length >= 8 && p.replace(/\D/g, "").length <= 15));
  const rawUrls = Array.from(text.matchAll(/\bhttps?:\/\/[^\s)>"']+|\b(?:www\.)[^\s)>"']+/gi), (m) => m[0].replace(/[.,;]+$/, ""));
  const socialDomains = /(instagram|facebook|twitter|x\.com|linkedin|tiktok|youtube|youtu\.be|pinterest|wa\.me|whatsapp|threads)/i;
  const socials = uniq([...rawUrls.filter((u) => socialDomains.test(u)), ...Array.from(text.matchAll(/(?<![\w@])@([a-z][\w.]{2,29})\b(?!\.\w)/gi), (m) => `@${m[1]}`)]);
  const urls = uniq(rawUrls.filter((u) => !socialDomains.test(u)));
  return { emails, phones, urls, socials };
}

export function extractQuotedCopy(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/["“”]([^"“”]{12,220})["“”]/g)) {
    const q = m[1].replace(/\s+/g, " ").trim();
    if (q.split(" ").length >= 3) out.push(q);
  }
  return uniq(out);
}

export function extractPrices(text: string): string[] {
  return uniq(Array.from(text.matchAll(/(?:[$€£₦₵]|USD|NGN|GHS|KES|ZAR|GBP|EUR)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:\/|per)\s?\w+)?/gi), (m) => clean(m[0])));
}

export function extractSections(text: string): string[] {
  // an explicit list ("sections: hero, about, pricing", "pages: ...", "include ...") is strongest
  const found: string[] = [];
  const list = text.match(/\b(?:sections?|pages?|include|including|with|should have|needs?|I want)\s*[:\-]?\s*([^.\n]{8,260})/gi) ?? [];
  const scope = list.length ? list.join(" ; ") : "";
  for (const [name, re] of SECTION_WORDS) if (re.test(scope) || re.test(text.split("\n").filter((l) => /^\s*(?:[-*•\d]+[.)]?)\s/.test(l)).join(" "))) found.push(name);
  return uniq(found);
}

export function extractTone(text: string): string[] {
  const lower = text.toLowerCase();
  return uniq(TONE_WORDS.filter((w) => new RegExp(`\\b${w}\\b`).test(lower)));
}

export function detectIndustry(text: string): string | undefined {
  for (const [name, re] of INDUSTRIES) if (re.test(text)) return name;
  return undefined;
}

const LANG_MARKERS: Array<[string, RegExp]> = [
  ["French", /\b(je veux|pour (?:mon|ma|mes)|site web|une page|entreprise|nous (?:sommes|proposons)|boulangerie|crée|créer|s'il vous plaît)\b/i],
  ["Spanish", /\b(quiero|necesito|para mi|sitio web|página|empresa|somos|panadería|crea(?:r)? una|por favor)\b/i],
  ["Portuguese", /\b(quero|preciso|para (?:o )?meu|meu negócio|nosso|padaria|criar uma|página de)\b/i],
  ["German", /\b(ich möchte|ich brauche|für (?:mein|meine)|webseite|unternehmen|wir sind|bäckerei|erstelle)\b/i],
  ["Italian", /\b(voglio|ho bisogno|per la mia|sito web|azienda|siamo|panetteria|crea una)\b/i],
  ["Swahili", /\b(nataka|tovuti|biashara yangu|tafadhali|karibu)\b/i],
];
export function detectLanguage(text: string): string | undefined {
  if (/[؀-ۿ]/.test(text)) return "Arabic";
  if (/[一-鿿]/.test(text)) return "Chinese";
  if (/[ऀ-ॿ]/.test(text)) return "Hindi";
  for (const [lang, re] of LANG_MARKERS) if (re.test(text)) return lang;
  return undefined;
}

const NAME_TOKEN = String.raw`[A-Z][\w'’-]*`;
const NAME_RUN = String.raw`${NAME_TOKEN}(?:\s+(?:&\s+|and\s+|of\s+)?${NAME_TOKEN}){0,3}(?:\.(?<=\b(?:Co|Inc|Ltd|LLC)\.))?`;
const NOT_A_NAME = /^(?:SaaS|AI|API|CEO|UK|USA|UAE|B2B|B2C|CRM|SEO|I|Lagos|Accra|Nairobi|London|Africa|English|French)$/;
const PREPOSITIONS = new Set(["in", "at", "from", "based", "near", "around", "across", "that", "which", "who", "to", "and", "with", "dans", "à", "en"]);

export function extractName(text: string): string | undefined {
  const tries: Array<RegExpMatchArray | null> = [
    // "called Crumb & Co", "named 'Glow'", 'name is "Glow Studio"'
    text.match(new RegExp(String.raw`\b(?:called|named|name is|name:|brand is|business is|company is|calling it|appelée?|llamad[oa]|chamad[oa])\s*["“']?(${NAME_RUN})`)),
    // a label on its own line: "Name: Glow Studio", "Business: ..."
    text.match(new RegExp(String.raw`(?:^|\n)\s*(?:name|brand|business|company)\s*[:\-]\s*["“']?(${NAME_RUN})`, "i")),
    // "for Iron Haven Gym", "for my bakery, Le Petit Pain", "pour ma boulangerie, Le Petit Pain"
    text.match(new RegExp(String.raw`\b(?:for|pour|para|f[üu]r|per)\s+(?:(?:my|our|the|ma|mon|mi|mein|meine)\s+)?((?:[a-zà-ÿ-]+,?\s+){0,3}?)["“]?(${NAME_RUN})`)),
    // "Hope Kitchen, a charity ..." / "Hope Kitchen is a ..."
    text.match(new RegExp(String.raw`(?:^|[.!?]\s+|\n)(${NAME_RUN}),?\s+(?:is|are|offers?|provides?|sells?|helps?|est|es)\s+(?:a|an|the|your|people|businesses|une?)\b`)),
    // "Ama's Bakery"
    text.match(/\b([A-Z][\w]+['’]s(?:\s+[A-Z][\w]+){1,2})\b/),
  ];
  for (let n = 0; n < tries.length; n++) {
    const m = tries[n];
    if (!m) continue;
    if (n === 2) {
      // the lowercase words before the name must not be a place or a clause ("for my bakery in Accra")
      const between = (m[1] ?? "").toLowerCase().split(/[\s,]+/).filter(Boolean);
      if (between.some((w) => PREPOSITIONS.has(w))) continue;
    }
    const v = clean(m[n === 2 ? 2 : 1]);
    if (v.length < 2 || NOT_A_NAME.test(v) || STOP_NAME_WORDS.has(v.toLowerCase().split(" ")[0])) continue;
    return v;
  }
  return undefined;
}

export function extractOffer(text: string): string | undefined {
  const m =
    text.match(/\b(?:we|I|they)\s+(sell|offer|provide|make|bake|teach|help|run|do|build|design|create|specialis[ez]e in|specialize in|craft|deliver|repair|train|coach)\s+([^.\n;]{6,160})/i) ??
    text.match(/\b(?:selling|offering|providing|specialising in|specializing in)\s+([^.\n;]{6,140})/i) ??
    text.match(/\b(?:what we do|about (?:us|the business)|business)\s*[:\-]\s*([^\n]{8,200})/i);
  if (!m) return undefined;
  const full = m.length === 3 ? `${m[1]} ${m[2]}` : m[1];
  return clean(full);
}

export function extractAudience(text: string): string | undefined {
  const m =
    text.match(/\b(?:target audience|audience|our customers? (?:are|is)|my customers? (?:are|is)|our clients? (?:are|is)|my clients? (?:are|is)|aimed at|targeting|who it'?s for|serving|we serve|we help|i help|helping)\s*[:\-]?\s*([^.\n;]{4,120})/i) ??
    text.match(/\bfor\s+((?:busy|young|small|first[- ]time|local|working|new|growing|health[- ]conscious|high[- ]end|budget|corporate|early[- ]stage|independent|older)\s[^.\n;,]{3,80}|(?:parents|families|students|freelancers|founders|entrepreneurs|startups|couples|brides|teachers|professionals|creators|homeowners|landlords|tourists|travellers|travelers|patients|members|donors|churches|schools|restaurants)\b[^.\n;]{0,60})/i);
  return m ? clean(m[1]) : undefined;
}

export function extractGoal(text: string): PageGoal | undefined {
  const t = text.toLowerCase();
  if (/\blink[- ]in[- ]bio\b/.test(t)) return "link-in-bio";
  if (/\b(online store|online shop|e-?commerce|webshop|sell(?:ing)? (?:products|online)|shopping cart)\b/.test(t) || /\b(?:my|a|an|the)\s+(?:store|shop)\b/.test(t)) return "store";
  if (/\bportfolio\b/.test(t)) return "portfolio";
  if (/\b(blog|magazine)\b/.test(t) && !/landing/.test(t)) return "blog";
  if (/\b(course|online class|ebook|digital product|webinar)\b/.test(t)) return "course";
  if (/\b(event|conference|wedding|rsvp|festival)\b/.test(t)) return "event";
  if (/\b(web app|saas dashboard|sign-?ins?|user accounts|dashboard app)\b/.test(t)) return "app";
  if (/\blanding page\b/.test(t)) return "landing";
  if (/\b(website|web site|multi-?page|several pages|home,? about)\b/.test(t)) return "business-site";
  if (/\b(page|site|p[áa]gina|sitio|sito|webseite|tovuti)\b/.test(t)) return "landing";
  return undefined;
}

// ---------------------------------------------------------------- brief

const GOAL_FROM_ACCOUNT: Record<string, PageGoal> = { store: "store", "business-site": "business-site", blog: "blog", course: "course", "link-in-bio": "link-in-bio", landing: "landing", app: "app" };

/** The questions SOL asks, keyed so an answer can be matched back to the field it fills. */
export type QuestionKey = "offer" | "name" | "audience" | "cta" | "tone" | "brand" | "logo" | "content" | "sections";
export const QUESTION_TEXT: Record<QuestionKey, string> = {
  offer: "What do you do or sell, in a sentence?",
  name: "What's the business called?",
  audience: "Who is it for?",
  cta: "What's the one thing visitors should do?",
  tone: "What feel should it have?",
  brand: "Do you have brand colours or a logo?",
  logo: "Do you have a logo?",
  content: "Anything you already have that I should use?",
  sections: "What should the page include?",
};
export const SKIP_ANSWER = "Skip, you choose";

function keyOfQuestion(question: string): QuestionKey | undefined {
  const q = question.trim().toLowerCase();
  return (Object.keys(QUESTION_TEXT) as QuestionKey[]).find((k) => QUESTION_TEXT[k].toLowerCase() === q);
}
const isSkip = (a: string) => /^\s*(skip|you choose|you decide|just build it|surprise me)/i.test(a);

export function parseBrief(input: BriefInput): Brief {
  const current = input.text ?? "";
  const priors = input.priorUserTexts ?? [];
  const all = [...priors, current].join("\n");
  const wordCount = current.trim().split(/\s+/).filter(Boolean).length;

  const account = input.account ?? {};
  const site = input.site ?? {};

  // --- new build or a change to something that exists?
  const buildish = BUILD_VERB_RE.test(current) && PAGE_NOUN_RE.test(current);
  const editish = EDIT_START_RE.test(current) && !/\b(build|create|make) (?:me )?(?:a|an|another) (?:new )?(?:landing|website|site|page|store|shop|blog)/i.test(current);
  const isNewBuild = (buildish || PAGE_LEAD_RE.test(current) || (wordCount >= 25 && PAGE_NOUN_RE.test(all))) && !editish && !input.alreadyBuilt;

  const brief: Brief = {
    isNewBuild,
    goal: missing(), name: missing(), offer: missing(), industry: missing(), audience: missing(), cta: missing(), tone: missing(),
    colors: missing(), logo: missing(), fonts: missing(), sections: missing(), language: missing(),
    content: { headlines: [], emails: [], phones: [], urls: [], socials: [], prices: [], hasPhotos: false, hasTestimonials: false },
    constraints: [],
    skip: SKIP_RE.test(all),
    wordCount,
    richness: { score: 0, level: "simple" },
  };

  // --- goal
  const g = extractGoal(current) ?? extractGoal(all);
  if (g) brief.goal = known(g, "message");
  else if (account.goal && GOAL_FROM_ACCOUNT[account.goal]) brief.goal = inferred(GOAL_FROM_ACCOUNT[account.goal], "account");

  // --- brand facts already on the site / account (site wins)
  if (site.name) brief.name = known(site.name, "site");
  else if (account.name) brief.name = known(account.name, "account");
  if (site.about || account.about) brief.offer = known((site.about ?? account.about)!, site.about ? "site" : "account");
  if (site.industry || account.industry) brief.industry = known((site.industry ?? account.industry)!, site.industry ? "site" : "account");
  if (site.tone || account.tone) brief.tone = known((site.tone ?? account.tone)!, site.tone ? "site" : "account");
  if (site.colors?.length) brief.colors = known(site.colors, "site");
  else if (account.colors?.length) brief.colors = known(account.colors, "account");
  if (site.logoUrl) brief.logo = known<LogoState>("uploaded", "site");
  else if (site.noLogo) brief.logo = known<LogoState>("none", "site");
  else if (account.logoUrl) brief.logo = known<LogoState>("uploaded", "account");

  // --- what the owner wrote now (the message overrides stored defaults)
  const name = extractName(current) ?? extractName(all);
  if (name) {
    // A different business than the one on file: its saved colours, logo and facts are not theirs.
    const stored = brief.name.value;
    if (stored && stored.toLowerCase().replace(/[^a-z0-9]/g, "") !== name.toLowerCase().replace(/[^a-z0-9]/g, "") && brief.name.source !== "message") {
      brief.offer = missing(); brief.industry = missing(); brief.tone = missing(); brief.colors = missing(); brief.logo = missing();
    }
    brief.name = known(name, "message");
  }
  const offer = extractOffer(current) ?? extractOffer(all);
  if (offer) brief.offer = known(offer, "message");
  const industry = detectIndustry(all);
  if (industry && brief.industry.status === "missing") brief.industry = inferred(industry);
  else if (industry && brief.industry.source !== "message") brief.industry = known(industry, "message");
  if (brief.offer.status === "missing" && brief.industry.status !== "missing" && g) brief.offer = inferred(`${brief.industry.value} business`);
  const audience = extractAudience(all);
  if (audience) brief.audience = known(audience, "message");
  const explicitCta = all.match(/\b(?:main action|primary (?:action|button|cta)|call to action|cta|goal)\s*(?:is|:|should be)\s*([^.\n]{3,80})/i);
  if (explicitCta) brief.cta = known(clean(explicitCta[1]), "message");
  else for (const [label, re] of CTA_PATTERNS) {
    if (re.test(all)) { brief.cta = known(label, "message"); break; }
  }
  if (brief.cta.status === "missing") {
    if (brief.goal.value === "store") brief.cta = inferred("Buy or order now");
    else if (brief.goal.value === "course") brief.cta = inferred("Sign up");
  }
  const tones = extractTone(all);
  if (tones.length) brief.tone = known(tones.slice(0, 3).join(", "), "message");

  const hex = extractHexColors(all);
  const words = colourContext(all) ? extractColorWords(all) : [];
  const given = hex.length ? hex : words;
  if (given.length) brief.colors = known(given.slice(0, 6), "message");
  const fontM = all.match(/\b(?:[Ff]onts?|[Tt]ypography|[Tt]ypefaces?)\s*(?:is|are|:)\s*([^.\n]{3,120})/);
  const fontNames = fontM ? Array.from(fontM[1].matchAll(/\b[A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)*/g), (m) => m[0]) : [];
  if (fontNames.length) brief.fonts = known(uniq(fontNames).slice(0, 2).join(" + "), "message");

  // --- logo
  const imageAttachments = (input.attachments ?? []).filter((a) => (a.type ?? "").startsWith("image") || /\.(png|jpe?g|svg|webp)$/i.test(a.filename ?? a.url ?? ""));
  const logoAttachment = imageAttachments.find((a) => /logo|brand/i.test(`${a.filename ?? ""} ${a.url ?? ""}`)) ?? (HAS_LOGO_RE.test(all) ? imageAttachments[0] : undefined) ?? (imageAttachments.length === 1 && wordCount < 40 && !brief.logo.value ? imageAttachments[0] : undefined);
  if (NO_LOGO_RE.test(all)) brief.logo = known<LogoState>("none", "message");
  if (logoAttachment) {
    brief.logo = known<LogoState>("uploaded", "logo");
    if (logoAttachment.colors?.length && !hex.length) brief.colors = known(logoAttachment.colors.slice(0, 4), "logo");
  } else if (/\blogo\b[^.\n]*https?:\/\/\S+|https?:\/\/\S*logo\S*/i.test(all) && brief.logo.source !== "site") {
    brief.logo = known<LogoState>("link", "message");
  } else if (HAS_LOGO_RE.test(all) && brief.logo.status === "missing") {
    brief.logo = known<LogoState>("will-send", "message");
  }

  // --- content the owner supplied
  const contacts = extractContacts(current === all ? current : all);
  brief.content = {
    headlines: extractQuotedCopy(all),
    ...contacts,
    prices: extractPrices(all),
    hasPhotos: imageAttachments.length > (logoAttachment ? 1 : 0) || /\b((?:my|our) (?:own )?(?:product |team |brand )?(?:photos|pictures|images)|photos (?:attached|below)|i have (?:photos|pictures|images))\b/i.test(all),
    hasTestimonials: /\b(testimonials?|reviews?)\b[^.\n]*[:"“]/i.test(all),
  };

  // --- sections, language, constraints
  const labelled = all.match(/(?:^|\n)\s*(?:sections?|pages?)\s*[:\-]\s*([^\n]{12,600})/i);
  const listed = labelled ? labelled[1].replace(/\([^)]*\)/g, "").split(/\s*(?:,|;|\band\b)\s*/i).map((x) => clean(x.replace(/^(?:a|an|the)\s+/i, ""))).filter((x) => x.length >= 3 && x.length <= 40) : [];
  const sections = listed.length >= 3 ? uniq(listed).slice(0, 12) : extractSections(all);
  if (sections.length) brief.sections = known(sections, "message");
  const lang = detectLanguage(all);
  if (lang) brief.language = known(lang, "message");
  if (/\b(no stock photos?|don'?t use stock)\b/i.test(all)) brief.constraints.push("No stock photos.");
  if (/\b(one page|single page|one-page)\b/i.test(all)) brief.constraints.push("Keep it to one page.");
  if (/\b(accessible|wcag|a11y)\b/i.test(all)) brief.constraints.push("Must meet accessibility (WCAG) contrast and structure.");
  if (/\b(no (?:animations?|popups?|pop-ups))\b/i.test(all)) brief.constraints.push("No animations or pop-ups.");
  if (/\bmobile[- ]first\b/i.test(all)) brief.constraints.push("Mobile first.");

  // --- answers to SOL's earlier questions (override everything else)
  for (const a of input.answers ?? []) applyAnswer(brief, a.question, a.answer);

  brief.richness = richness(brief);
  return brief;
}

/** Fills the field a question stands for from the owner's answer ("Skip, you choose" leaves it to SOL). */
export function applyAnswer(brief: Brief, question: string, answer: string): void {
  const key = keyOfQuestion(question);
  const a = answer.trim();
  if (!key || !a) return;
  if (isSkip(a)) {
    brief.skip = true;
    return;
  }
  const set = <T,>(f: Field<T>, v: T) => Object.assign(f, known(v, "answer"));
  switch (key) {
    case "offer": set(brief.offer, a); { const ind = detectIndustry(a); if (ind && brief.industry.status !== "known") Object.assign(brief.industry, inferred(ind)); } break;
    case "name": if (/^(suggest|pick|you (?:pick|choose))/i.test(a)) Object.assign(brief.name, inferred("a name SOL suggests")); else set(brief.name, a.replace(/^(use my own name:?|it'?s|it is)\s*/i, "")); break;
    case "audience": set(brief.audience, a); break;
    case "cta": set(brief.cta, a); break;
    case "tone": set(brief.tone, a); break;
    case "brand":
    case "logo": {
      if (NO_LOGO_RE.test(a) || /^(no|none|neither|no,)/i.test(a) || /wordmark/i.test(a)) set(brief.logo, "none");
      else if (/\b(attach|upload|send|logo)\b/i.test(a) && !/colou?rs?/i.test(a.replace(/logo'?s? colou?rs?/i, ""))) set(brief.logo, "will-send");
      const hex = extractHexColors(a);
      const words = extractColorWords(a);
      if (hex.length || words.length) set(brief.colors, [...hex, ...words]);
      else if (key === "brand" && !/attach|upload|logo|neither|none|you choose/i.test(a)) set(brief.colors, [a]);
      if (/\b(neither|none)\b/i.test(a) && brief.colors.status === "missing") Object.assign(brief.colors, inferred(["palette chosen by SOL"]));
      break;
    }
    case "content": {
      const c = extractContacts(a);
      brief.content.emails = uniq([...brief.content.emails, ...c.emails]);
      brief.content.phones = uniq([...brief.content.phones, ...c.phones]);
      brief.content.urls = uniq([...brief.content.urls, ...c.urls]);
      brief.content.socials = uniq([...brief.content.socials, ...c.socials]);
      brief.content.prices = uniq([...brief.content.prices, ...extractPrices(a)]);
      if (/photos?|pictures|images/i.test(a)) brief.content.hasPhotos = true;
      if (!/^(no|nothing|not yet|none)\b/i.test(a)) brief.content.headlines = uniq([...brief.content.headlines, ...extractQuotedCopy(a)]);
      break;
    }
    case "sections": {
      const s = extractSections(`sections: ${a}`);
      set(brief.sections, s.length ? s : [a]);
      break;
    }
  }
}

/** How much the owner has told us: a simple prompt is 0-2, a medium one 3-6, a full brief 7+. */
function richness(b: Brief): { score: number; level: "simple" | "medium" | "rich" } {
  const fromMessage = (f: Field<unknown>) => f.status === "known" && (f.source === "message" || f.source === "answer" || f.source === "logo");
  let s = 0;
  if (fromMessage(b.name)) s += 1;
  if (fromMessage(b.offer)) s += 1.5;
  if (fromMessage(b.audience)) s += 1;
  if (fromMessage(b.cta)) s += 1;
  if (fromMessage(b.tone)) s += 1;
  if (fromMessage(b.colors)) s += 1;
  if (fromMessage(b.logo)) s += 0.5;
  if (fromMessage(b.fonts)) s += 0.5;
  if (fromMessage(b.sections)) s += Math.min(2, ((b.sections.value?.length ?? 0) / 3) * 1.5);
  const c = b.content;
  s += Math.min(2, c.headlines.length * 0.7 + (c.emails.length + c.phones.length + c.urls.length + c.socials.length) * 0.4 + c.prices.length * 0.4 + (c.hasTestimonials ? 0.5 : 0));
  s += Math.min(2, b.wordCount / 80);
  const score = Math.round(s * 10) / 10;
  return { score, level: score >= 7 ? "rich" : score >= 3 ? "medium" : "simple" };
}

// ---------------------------------------------------------------- questions

export type PlannedQuestion = {
  key: QuestionKey;
  header: string;
  question: string;
  options: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
};

export type QuestionPlan = {
  /** "ask": show the intake card first. "build": go straight to creative direction and building. */
  mode: "ask" | "build";
  questions: PlannedQuestion[];
  /** One plain line on what was understood / reused, shown before the card or the plan. */
  understood: string;
  /** What SOL will assume where it was not told (stated in one line when building). */
  assumptions: string[];
  /** Why no questions were asked (for tests and the eval report). */
  reason: "ask" | "not-new-build" | "already-asked" | "skip" | "enough";
};

const CATALOGUE: Record<QuestionKey, Omit<PlannedQuestion, "key" | "question">> = {
  offer: { header: "Your business", options: [{ label: "I sell products", description: "Things people can buy" }, { label: "I offer a service", description: "Bookings, quotes or enquiries" }, { label: "I teach or coach", description: "Courses, lessons, programmes" }, { label: "I run a cause or community", description: "Donations, members, events" }] },
  name: { header: "Name", options: [{ label: "Suggest a name for me" }, { label: "Use my own name" }] },
  audience: { header: "Your audience", options: [{ label: "Local customers", description: "People nearby" }, { label: "Busy professionals" }, { label: "Families and parents" }, { label: "Other businesses" }] },
  cta: { header: "Main action", options: [{ label: "Buy or order now" }, { label: "Book a call or appointment" }, { label: "Get in touch" }, { label: "Sign up or subscribe" }] },
  tone: { header: "Feel", options: [{ label: "Warm and friendly", description: "Soft colours, round shapes" }, { label: "Bold and modern", description: "Strong colours, big type" }, { label: "Calm and clean", description: "Lots of space" }, { label: "Elegant and premium", description: "Refined, quiet luxury" }] },
  brand: { header: "Colours and logo", options: [{ label: "I'll attach my logo", description: "I'll use its colours" }, { label: "I have colours", description: "I'll type them" }, { label: "No logo, make a simple wordmark", description: "You choose the palette" }, { label: "Show me palette ideas", description: "You choose" }] },
  logo: { header: "Logo", options: [{ label: "I'll attach it" }, { label: "No logo, make a simple wordmark" }] },
  content: { header: "What you have", options: [{ label: "I have copy and photos" }, { label: "I have prices and contact details" }, { label: "Nothing yet, write it for me" }], multiSelect: true },
  sections: { header: "Sections", options: [{ label: "Reviews and FAQ" }, { label: "Pricing or packages" }, { label: "Gallery or portfolio" }, { label: "A contact form" }], multiSelect: true },
};

const ORDER: QuestionKey[] = ["offer", "name", "audience", "cta", "tone", "brand", "logo", "content", "sections"];
const CAP = { simple: 6, medium: 4, rich: 1 } as const;

function isMissing(b: Brief, k: QuestionKey): boolean {
  switch (k) {
    case "offer": return b.offer.status === "missing" || (b.offer.status === "inferred" && !b.offer.value?.includes(" "));
    case "name": return b.name.status === "missing";
    case "audience": return b.audience.status === "missing";
    case "cta": return b.cta.status === "missing";
    case "tone": return b.tone.status === "missing";
    // colours and logo are one question when both are open; just the open half otherwise
    case "brand": return b.colors.status === "missing" && b.logo.status === "missing";
    case "logo": return b.colors.status !== "missing" && b.logo.status === "missing";
    case "content": return !(b.content.emails.length || b.content.phones.length || b.content.prices.length || b.content.headlines.length || b.content.hasPhotos);
    case "sections": return b.sections.status === "missing";
  }
}

/** Plain, one-line statement of what SOL already has and will reuse. */
export function understoodLine(b: Brief): string {
  const parts: string[] = [];
  const brandBits: string[] = [];
  if (b.name.status === "known" && (b.name.source === "site" || b.name.source === "account")) brandBits.push("name");
  if (b.colors.status === "known" && (b.colors.source === "site" || b.colors.source === "account" || b.colors.source === "logo")) brandBits.push("colours");
  if (b.logo.status === "known" && b.logo.source !== "message") brandBits.push(b.logo.value === "none" ? "simple wordmark" : "logo");
  if (brandBits.length) parts.push(`I'll use your brand (${brandBits.join(", ")}).`);
  const fromYou: string[] = [];
  if (b.name.status === "known" && b.name.source === "message") fromYou.push(`${b.name.value}`);
  if (b.offer.status === "known" && b.offer.source === "message") fromYou.push(`what you do`);
  if (b.audience.status === "known") fromYou.push("who it's for");
  if (b.cta.status === "known" && b.cta.source === "message") fromYou.push("the main action");
  if (b.colors.status === "known" && b.colors.source === "message") fromYou.push("your colours");
  if (b.tone.status === "known" && b.tone.source === "message") fromYou.push("the feel");
  if (b.sections.status === "known") fromYou.push("the sections");
  const supplied = b.content.headlines.length + b.content.emails.length + b.content.phones.length + b.content.prices.length + b.content.socials.length + b.content.urls.length;
  if (supplied) fromYou.push("the copy and details you gave me");
  if (fromYou.length) parts.push(`I've got ${fromYou.length > 1 ? fromYou.slice(0, -1).join(", ") + " and " + fromYou[fromYou.length - 1] : fromYou[0]}.`);
  return parts.join(" ");
}

/** The sensible choices SOL makes (and says out loud) for everything it was not told. */
export function assumptionsFor(b: Brief): string[] {
  const out: string[] = [];
  if (b.name.status !== "known") out.push("a short business name taken from what you described (easy to rename)");
  if (b.tone.status !== "known") out.push("a feel that suits your kind of business");
  if (b.colors.status !== "known") out.push("a palette that suits your business");
  if (b.logo.status === "missing" || (b.logo.status === "known" && b.logo.value === "none")) out.push("a clean wordmark made from your name instead of a logo");
  if (b.audience.status !== "known") out.push("your likely customers as the audience");
  if (b.cta.status !== "known") out.push("one clear main button that fits your goal");
  if (b.sections.status !== "known") out.push("the sections that work best for your kind of page");
  const sampleBits = [!(b.content.prices.length) && "prices", !(b.content.emails.length || b.content.phones.length) && "contact details", !(b.content.headlines.length) && "reviews"].filter(Boolean);
  if (sampleBits.length) out.push(`sample ${sampleBits.join(", ")} clearly marked so you can swap in the real ones`);
  return out;
}

export function planQuestions(b: Brief, input: Partial<BriefInput> = {}): QuestionPlan {
  const understood = understoodLine(b);
  const assumptions = assumptionsFor(b);
  const none = (reason: QuestionPlan["reason"]): QuestionPlan => ({ mode: "build", questions: [], understood, assumptions, reason });
  if (!b.isNewBuild) return none("not-new-build");
  if (input.alreadyAsked) return none("already-asked");
  if (b.skip) return none("skip");

  const level = b.richness.level;
  let wanted = ORDER.filter((k) => isMissing(b, k));
  if (level === "rich") {
    // a full brief asks nothing unless something critical is truly absent: the business has no name or no idea what it is
    const critical: QuestionKey[] = [];
    if (b.name.status === "missing") critical.push("name");
    else if (b.offer.status === "missing" && b.industry.status === "missing") critical.push("offer");
    wanted = critical;
  } else {
    // content and sections are only worth a round when the owner is already being specific
    if (level === "simple") wanted = wanted.filter((k) => k !== "content" && k !== "sections");
  }
  const questions = wanted.slice(0, CAP[level]).map((k) => ({ key: k, question: QUESTION_TEXT[k], ...CATALOGUE[k] }));
  // offer a real default for the name question when the account already holds a name-like fact
  if (questions.length === 0) return none("enough");
  return { mode: "ask", questions, understood, assumptions, reason: "ask" };
}

/** The exact ask_user_question arguments for a plan (the card adds "Skip, you choose" and free text itself). */
export function askArgsFor(plan: QuestionPlan): { questions: Array<{ question: string; header: string; options: Array<{ label: string; description?: string }>; multiSelect?: boolean }> } {
  return { questions: plan.questions.map(({ question, header, options, multiSelect }) => ({ question, header, options, ...(multiSelect ? { multiSelect } : {}) })) };
}

/** Facts the owner gave in chat that the site's own brand doesn't hold yet (offer to save them). */
export function newBrandFacts(b: Brief, siteBrand?: KnownBrand): { colors?: string[]; noLogo?: boolean; hasChange: boolean } {
  const colors = b.colors.status === "known" && (b.colors.source === "message" || b.colors.source === "answer" || b.colors.source === "logo") ? b.colors.value?.filter((c) => /^#[0-9A-F]{6}$/i.test(c)) : undefined;
  const sameColors = colors && siteBrand?.colors && colors.join() === siteBrand.colors.join();
  const noLogo = b.logo.status === "known" && b.logo.value === "none" && b.logo.source !== "site" && !siteBrand?.noLogo ? true : undefined;
  const out = { ...(colors?.length && !sameColors ? { colors } : {}), ...(noLogo ? { noLogo } : {}) };
  return { ...out, hasChange: Object.keys(out).length > 0 };
}
