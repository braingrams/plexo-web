/**
 * What kind of business is this? One shared list, used on BOTH sides of "which design fits me":
 *  - the owner is classified into a type (they pick it, SOL reads their description, or a keyword reading of the
 *    name + description guesses it), and
 *  - every marketplace design is classified into the same types (from the category its seller chose, refined by
 *    its name and description).
 * Matching type to type is far more reliable than matching loose words, and it works when the owner never says
 * what they do ("Iron & Grain" says nothing, but "Iron & Grain Gym" or "we help people get strong" does).
 * Pure and browser-safe.
 */

export type BusinessType = {
  id: string;
  /** What the owner sees. Plain words, never jargon. */
  label: string;
  /** A few words that say what it covers, shown under the label. */
  covers: string;
  /** Words that, on their own, nearly always mean this type (weighted high). */
  strong: string[];
  /** Words that hint at it (weighted low, add up). */
  weak: string[];
  /** Matches a marketplace category name the seller chose. */
  category?: RegExp;
};

export const BUSINESS_TYPES: BusinessType[] = [
  {
    id: "fitness", label: "Gym & fitness", covers: "Gyms, personal trainers, sports clubs",
    strong: ["gym", "gyms", "fitness", "personal trainer", "personal training", "crossfit", "powerlifting", "bodybuilding", "boxing", "martial arts", "calisthenics", "bootcamp fitness", "strength training", "sports club", "pt studio", "weightlifting", "sportswear", "activewear", "gym wear"],
    weak: ["workout", "workouts", "trainer", "training", "exercise", "athlete", "athletes", "strength", "weights", "muscle", "sports", "running", "cardio", "gains", "coaching clients fit", "get fit", "get strong", "lose weight"],
    category: /fitness|gym|sport/,
  },
  {
    id: "wellness", label: "Yoga, spa & wellbeing", covers: "Yoga, pilates, massage, spas, meditation",
    strong: ["yoga", "pilates", "meditation", "mindfulness", "massage", "spa", "wellness", "holistic", "reiki", "acupuncture", "sauna"],
    weak: ["calm", "relax", "relaxing", "retreat", "breathwork", "self care", "wellbeing", "well-being", "healing"],
    category: /wellness|spa\b|yoga/,
  },
  {
    id: "care", label: "Care homes & home care", covers: "Nursing homes, carers, elderly and dementia care",
    strong: ["care home", "nursing home", "home care", "homecare", "carer", "carers", "caregiver", "caregivers", "elderly", "dementia", "assisted living", "residential care", "respite", "care agency", "domiciliary", "senior care", "hospice", "nursing care", "memory care"],
    weak: ["nursing", "nurse", "nurses", "seniors", "care", "caring", "residents", "older people", "elder"],
    category: /nursing|care home|care\b|elder|senior/,
  },
  {
    id: "health", label: "Clinics & healthcare", covers: "Doctors, dentists, therapists, hospitals, pharmacies",
    strong: ["clinic", "clinics", "doctor", "doctors", "dentist", "dental", "dentistry", "hospital", "physio", "physiotherapy", "physiotherapist", "therapist", "therapy", "counselling", "counseling", "psychologist", "psychiatrist", "pharmacy", "paediatric", "pediatric", "optician", "optometrist", "gp practice", "medical", "healthcare", "orthodontist", "dermatologist", "chiropractor", "veterinary", "vet clinic", "diagnostics", "laboratory"],
    weak: ["health", "patient", "patients", "appointment", "appointments", "treatment", "treatments", "mental health", "surgery"],
    category: /health|clinic|medical|dental|hospital|therap|doctor|pharma/,
  },
  {
    id: "restaurant", label: "Restaurant, cafe & food", covers: "Restaurants, cafes, bakeries, caterers, chefs",
    strong: ["restaurant", "restaurants", "cafe", "café", "coffee shop", "bakery", "bakeries", "catering", "caterer", "bistro", "bar and grill", "pizzeria", "takeaway", "takeout", "diner", "eatery", "food truck", "pastry", "patisserie", "chef", "canteen", "buka", "brewery", "winery", "wine bar", "food", "cook", "cooking", "jollof", "soup", "soups", "suya", "home cooked", "baker", "bake", "baking"],
    weak: ["menu", "dining", "cuisine", "meals", "cakes", "cake", "kitchen", "drinks", "reservations", "reservation", "lunch", "dinner", "breakfast", "coffee", "tea"],
    category: /restaurant|food|drink|cafe|dining|bakery/,
  },
  {
    id: "beauty", label: "Beauty, hair & skincare", covers: "Salons, barbers, makeup, skincare, nails",
    strong: ["salon", "barber", "barbershop", "hairdresser", "hair stylist", "makeup", "make-up", "skincare", "skin care", "nails", "nail", "lashes", "eyelash", "beautician", "beauty", "cosmetics", "braids", "wig", "wigs", "hairstyle", "aesthetics", "waxing"],
    weak: ["hair", "glow", "skin", "grooming", "stylist"],
    category: /beauty|skincare|salon|cosmetic|hair/,
  },
  {
    id: "fashion", label: "Fashion & clothing", covers: "Clothing brands, tailors, boutiques, jewellery",
    strong: ["fashion", "clothing", "apparel", "boutique", "tailor", "tailoring", "streetwear", "jewellery", "jewelry", "lookbook", "ankara", "sneakers", "garments", "menswear", "womenswear", "thrift", "fashion designer"],
    weak: ["outfit", "outfits", "wear", "style", "collection", "collections", "shoes", "bags", "accessories", "designer"],
    category: /fashion|apparel|cloth|jewel/,
  },
  {
    id: "retail", label: "Online shop or store", covers: "Selling products: shops, stores, makers, subscriptions",
    strong: ["online store", "online shop", "ecommerce", "e-commerce", "webshop", "storefront", "retail", "retailer", "merch", "dropshipping", "wholesale", "shop online", "sell products", "sells products", "furniture", "homeware", "candles", "supermarket", "groceries", "marketplace"],
    weak: ["shop", "store", "products", "product", "buy", "orders", "delivery", "shipping", "sell", "selling", "gadgets", "gifts"],
    category: /ecommerce|e-commerce|store|shop|retail/,
  },
  {
    id: "tech", label: "Software, app or tech product", covers: "SaaS, apps, developer tools, startups, fintech",
    strong: ["saas", "software", "startup", "start-up", "mobile app", "web app", "developer", "developers", "api", "platform for", "ai tool", "chatbot", "devtool", "dev tools", "open source", "fintech", "cybersecurity", "it services"],
    weak: ["cloud", "app", "ai", "automation", "dashboard", "analytics", "tech", "technology", "digital product", "code", "coding", "integration", "workflow", "payments"],
    category: /saas|developer|mobile app|\bapp\b|tech|software|fintech/,
  },
  {
    id: "finance", label: "Finance, accounting & insurance", covers: "Advisers, accountants, banks, loans, insurance",
    strong: ["accountant", "accountants", "accounting", "bookkeeping", "financial adviser", "financial advisor", "wealth", "insurance", "mortgage", "tax", "microfinance", "loans", "investment", "pension", "audit", "bank", "cooperative society", "forex", "trading"],
    weak: ["finance", "financial", "savings", "money", "invest", "funds", "payroll"],
    category: /financ|fintech|account|insurance|bank/,
  },
  {
    id: "professional", label: "Law, consulting & professional services", covers: "Lawyers, consultants, recruiters, firms",
    strong: ["law firm", "lawyer", "lawyers", "attorney", "solicitor", "barrister", "legal", "consultancy", "consulting", "consultant", "recruitment", "recruiter", "hr services", "notary", "immigration", "engineering firm", "surveyor", "logistics", "freight", "business services", "b2b"],
    weak: ["firm", "advisory", "advice", "professional", "compliance", "practice", "contracts"],
    category: /professional|law|legal|consult/,
  },
  {
    id: "agency", label: "Agency or studio", covers: "Marketing, branding, design and web studios",
    strong: ["agency", "marketing agency", "digital agency", "branding", "seo", "advertising", "pr firm", "design studio", "web design", "creative agency", "social media management", "content agency", "growth agency", "video production"],
    weak: ["studio", "campaigns", "brands", "marketing", "clients", "creative"],
    category: /agency|studio/,
  },
  {
    id: "creative", label: "Portfolio: photographer, designer, artist", covers: "Photographers, filmmakers, designers, architects, illustrators",
    strong: ["photographer", "photography", "filmmaker", "videographer", "illustrator", "illustration", "graphic designer", "architect", "architecture", "interior design", "interior designer", "artist", "painter", "animator", "portfolio", "freelance designer", "motion designer", "photo studio", "wedding photographer"],
    weak: ["gallery", "design", "designer", "creative", "freelancer", "freelance", "visual", "art", "work samples", "projects"],
    category: /portfolio|photo|video|architect|creative|design|art\b/,
  },
  {
    id: "music", label: "Music, DJ & entertainment", covers: "Musicians, bands, DJs, comedians, podcasters, creators",
    strong: ["musician", "singer", "band", "dj", "rapper", "songwriter", "album", "spotify", "soundcloud", "concert", "gig", "gigs", "comedian", "podcast", "podcaster", "youtuber", "content creator", "influencer", "actor", "actress", "vocalist", "afrobeats", "choir"],
    weak: ["music", "producer", "songs", "tour", "shows", "stage", "live", "streaming", "entertainment", "talent"],
  },
  {
    id: "education", label: "School, courses & coaching", covers: "Schools, tutors, academies, coaches, online courses",
    strong: ["school", "schools", "academy", "tutor", "tutoring", "tutorial", "course", "courses", "online course", "coach", "coaching", "mentor", "mentoring", "mentorship", "bootcamp", "cohort", "lessons", "nursery", "daycare", "kindergarten", "university", "college", "training institute", "masterclass", "workshop", "language school", "driving school", "mastermind"],
    weak: ["learn", "learning", "students", "student", "teach", "teaching", "teacher", "class", "classes", "education", "curriculum", "lessons", "training"],
    category: /school|academ|educat|course|coach|learn|tutor/,
  },
  {
    id: "realestate", label: "Real estate & property", covers: "Estate agents, landlords, developers, short-lets",
    strong: ["real estate", "estate agent", "estate agency", "realtor", "property", "properties", "landlord", "letting", "lettings", "apartments", "apartment", "short let", "shortlet", "property developer", "house hunting", "land for sale", "mortgage broker", "realty"],
    weak: ["homes", "houses", "rent", "rentals", "buy a home", "listings", "estate"],
    category: /real estate|property|realty|estate/,
  },
  {
    id: "hospitality", label: "Hotel, travel & stays", covers: "Hotels, lodges, guesthouses, tours, travel agents",
    strong: ["hotel", "hotels", "lodge", "guesthouse", "guest house", "resort", "airbnb", "bnb", "hostel", "travel agency", "travel agent", "tour operator", "tours", "safari", "vacation rental", "villa", "boutique hotel", "travel", "tourism", "tourist"],
    weak: ["stay", "stays", "rooms", "booking", "bookings", "holiday", "holidays", "trips", "getaway", "visa"],
    category: /hotel|travel|hospitality|tour|lodg/,
  },
  {
    id: "events", label: "Events, weddings & conferences", covers: "Event planners, venues, conferences, weddings",
    strong: ["event planner", "event planning", "events", "wedding", "weddings", "wedding planner", "conference", "summit", "venue", "event hall", "party", "parties", "festival", "expo", "ticketing", "tickets", "decor", "mc services", "photo booth"],
    weak: ["event", "celebration", "celebrations", "guests", "rsvp", "invitations"],
    category: /event|conference|wedding/,
  },
  {
    id: "nonprofit", label: "Church, charity & community", covers: "Churches, mosques, NGOs, foundations, campaigns",
    strong: ["church", "churches", "mosque", "ministry", "ministries", "charity", "charities", "ngo", "nonprofit", "non-profit", "foundation", "fundraising", "fundraiser", "donate", "donations", "community group", "volunteer", "volunteers", "parish", "congregation", "sermon"],
    weak: ["community", "mission", "outreach", "cause", "campaign", "support us", "give", "worship"],
    category: /nonprofit|non-profit|charit|church|ngo|communit/,
  },
  {
    id: "homeservices", label: "Home & trade services", covers: "Plumbers, electricians, cleaners, builders, mechanics",
    strong: ["plumber", "plumbing", "electrician", "electrical", "cleaning", "cleaners", "cleaning service", "builder", "builders", "construction", "contractor", "contractors", "roofing", "painter and decorator", "landscaping", "gardener", "gardening", "pest control", "handyman", "carpenter", "carpentry", "welding", "mechanic", "auto repair", "car wash", "hvac", "air conditioning", "laundry", "removals", "movers", "generator", "solar installation", "tiling", "fumigation"],
    weak: ["repairs", "repair", "installation", "maintenance", "fixing", "home services", "trade"],
  },
];

const BY_ID = new Map(BUSINESS_TYPES.map((t) => [t.id, t]));
export const BUSINESS_TYPE_IDS = BUSINESS_TYPES.map((t) => t.id);

export function businessTypeById(id: unknown): BusinessType | undefined {
  return typeof id === "string" ? BY_ID.get(id) : undefined;
}

export function parseBusinessType(id: unknown): string | undefined {
  return businessTypeById(id)?.id;
}

/** "gym" is found in "my gym" and "gyms", never inside another word ("app" is not in "happy"). */
function has(text: string, word: string): boolean {
  const w = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "[ \\-]+");
  return new RegExp(`(^|[^a-z0-9])${w}(s|es)?($|[^a-z0-9])`).test(text);
}

export type TypeGuess = { id: string; score: number; margin: number; confident: boolean };

/** Every type's score for some text, best first. Strong words weigh more than weak ones, and a longer phrase beats its parts. */
export function scoreBusinessTypes(rawText: string): Array<{ id: string; score: number }> {
  const text = rawText.toLowerCase();
  const out: Array<{ id: string; score: number }> = [];
  for (const t of BUSINESS_TYPES) {
    let score = 0;
    for (const w of t.strong) if (has(text, w)) score += w.includes(" ") ? 6 : 5;
    for (const w of t.weak) if (has(text, w)) score += w.includes(" ") ? 3 : 1.5;
    if (score > 0) out.push({ id: t.id, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * The most likely type for a name + description, or null when nothing in it points anywhere.
 * `confident` is true when the best type clearly beats the runner-up, so the caller knows when to ask the owner or SOL instead.
 */
export function inferBusinessType(...parts: Array<string | undefined>): TypeGuess | null {
  const ranked = scoreBusinessTypes(parts.filter(Boolean).join(" . "));
  const best = ranked[0];
  if (!best) return null;
  const second = ranked[1]?.score ?? 0;
  const margin = best.score - second;
  return { id: best.id, score: best.score, margin, confident: best.score >= 5 && margin >= Math.max(3, best.score * 0.35) };
}

/** How close two different types are (0 to 60): a nursing home owner is well served by a clinic design, but not by a gym one. */
const RELATED: Record<string, Record<string, number>> = {
  fitness: { wellness: 60, health: 20, music: 0 },
  wellness: { fitness: 60, health: 45, beauty: 45, care: 20 },
  care: { health: 55, wellness: 20 },
  health: { care: 55, wellness: 45, fitness: 20 },
  restaurant: { hospitality: 35, retail: 30, events: 20 },
  beauty: { wellness: 45, fashion: 40, retail: 35 },
  fashion: { retail: 55, beauty: 40, creative: 20 },
  retail: { fashion: 55, beauty: 35, restaurant: 30 },
  tech: { agency: 40, finance: 30, education: 20 },
  finance: { professional: 50, tech: 30, realestate: 25 },
  professional: { finance: 50, agency: 40, homeservices: 40, realestate: 30, education: 30 },
  agency: { creative: 50, professional: 40, tech: 40 },
  creative: { agency: 50, music: 40, fashion: 20 },
  music: { creative: 40, events: 30 },
  education: { professional: 30, tech: 20, nonprofit: 20 },
  realestate: { professional: 30, finance: 25, hospitality: 25, homeservices: 20 },
  hospitality: { restaurant: 35, events: 35, realestate: 25 },
  events: { hospitality: 35, music: 30, nonprofit: 25, restaurant: 20 },
  nonprofit: { events: 25, education: 20 },
  homeservices: { professional: 40, realestate: 20 },
};

export function typeCloseness(a: string, b: string): number {
  if (a === b) return 100;
  return RELATED[a]?.[b] ?? RELATED[b]?.[a] ?? 0;
}

/** What a design is, as far as business types go: the category its seller chose, sharpened by its name and description. */
export function listingBusinessTypes(l: { category: string | null; name: string; description: string | null }): { primary: string[]; also: string[] } {
  const cat = (l.category ?? "").toLowerCase();
  const fromCategory = BUSINESS_TYPES.filter((t) => t.category?.test(cat)).map((t) => t.id);
  const ranked = scoreBusinessTypes(`${l.name} . ${l.description ?? ""}`).filter((r) => r.score >= 5);
  let primary: string[];
  if (fromCategory.length === 1) primary = fromCategory;
  else if (fromCategory.length > 1) {
    // "Health & Wellness" matches two types: the design's own words decide which it is.
    const decided = ranked.find((r) => fromCategory.includes(r.id));
    primary = decided ? [decided.id] : fromCategory;
  } else {
    // A generic category ("Link in bio", "Portfolio", none at all): only the design's own words can say.
    primary = ranked[0] ? [ranked[0].id] : [];
  }
  const also = ranked.filter((r) => !primary.includes(r.id)).slice(0, 2).map((r) => r.id);
  return { primary, also };
}

/** Marketplace designs that suit a goal on their own, whatever the business ("I sell things" wants a shop design). */
export const GOAL_TYPE: Record<string, string[]> = { store: ["retail", "fashion"], course: ["education"] };

/**
 * How well one design fits one owner's business type, from -25 to 100. 100 is the same kind of business, a related one
 * scores less, an unrelated one is pushed down, and a design with no clear type is neutral (the goal and words decide).
 */
export function typeFit(owner: string | undefined, l: { category: string | null; name: string; description: string | null }, goal?: string): number {
  const { primary, also } = listingBusinessTypes(l);
  const wanted = goal ? GOAL_TYPE[goal] : undefined;
  const isGoalType = !!wanted && primary.some((p) => wanted.includes(p));
  // What the design is built as: a "link in bio" is a different thing from a full website, whatever the business.
  const isLinkPage = /link in bio|link-in-bio/i.test(l.category ?? "");
  const format = goal === "link-in-bio" ? (isLinkPage ? 40 : 0) : isLinkPage ? -30 : 0;
  if (!owner) return format + (isGoalType ? 70 : 0);
  if (!primary.length) return format + (isGoalType ? 70 : 0);
  let best = 0;
  for (const p of primary) best = Math.max(best, typeCloseness(owner, p));
  // A shop design that is clearly for this kind of business ("running shoe store" for a gym) is a good answer to "I sell things".
  for (const a of also) best = Math.max(best, Math.min(30, Math.round(typeCloseness(owner, a) * 0.5)));
  let fit = best === 0 ? (isGoalType ? 0 : -25) : best;
  if (wanted) {
    // Choosing "sell things" or "course" means the design should be built for that, with this business's flavour on top.
    if (isGoalType) fit += 70;
    else if (fit > 60) fit = 60;
  }
  return fit + format;
}
