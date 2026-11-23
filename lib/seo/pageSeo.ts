/**
 * What an owner can say about how ONE page appears in search, on top of its title, description and share picture:
 * keep it out of Google, name its main address, and add structured data ("rich results"). Pure and browser-safe, so the dashboard
 * can check what someone typed as they type it and the server applies exactly the same rules.
 *
 * Stored with the page's other search details (the design's `meta` for the new editor, `body.style` for the classic one):
 *   noindex "1" | "", canonicalUrl "", schemaJson (the final JSON-LD text that is published), schemaSource (the form the owner filled in).
 */

export type PageSeoExtras = { noindex: boolean; canonicalUrl: string; schemaJson: string; schemaSource: string };

type Bag = Record<string, unknown> | null | undefined;

/** Where a page keeps its search details, whichever editor made it. */
export function seoBagOf(designJson: unknown): Record<string, unknown> {
  const d = designJson as { meta?: Bag; body?: { style?: Bag } } | null | undefined;
  return (d?.meta ?? d?.body?.style ?? {}) as Record<string, unknown>;
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function readPageSeoExtras(designJson: unknown): PageSeoExtras {
  const bag = seoBagOf(designJson);
  return { noindex: bag.noindex === "1" || bag.noindex === true, canonicalUrl: str(bag.canonicalUrl, 500), schemaJson: str(bag.schemaJson, 20_000), schemaSource: str(bag.schemaSource, 20_000) };
}

export const isPageNoindex = (designJson: unknown): boolean => readPageSeoExtras(designJson).noindex;

// ── The main address (canonical URL) ─────────────────────────────────────────────────────────────────────

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * An empty answer clears it. A path ("/pricing") means a page on this site. A full address must be https and have no sign-in details.
 * Anything else is refused in plain words, so nobody can point their page at a script or a made-up scheme.
 */
export function checkCanonical(input: unknown): Checked<string> {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return { ok: true, value: "" };
  if (raw.length > 500) return { ok: false, error: "That address is too long." };
  if (raw.startsWith("/") && !raw.startsWith("//")) {
    if (/[\s<>"']/.test(raw)) return { ok: false, error: "A page address can't contain spaces or quotes." };
    return { ok: true, value: raw };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "Type a full web address starting with https://, or a page of this site like /pricing." };
  }
  if (url.protocol !== "https:") return { ok: false, error: "The main address has to start with https://." };
  if (url.username || url.password) return { ok: false, error: "The address can't contain a username or password." };
  if (!url.hostname.includes(".")) return { ok: false, error: "That doesn't look like a web address." };
  return { ok: true, value: url.toString() };
}

/** Turns what was saved into the absolute address to publish (a path becomes this site's address). */
export function resolveCanonical(saved: string, host: string): string {
  if (!saved) return "";
  return saved.startsWith("/") ? `https://${host}${saved}` : saved;
}

// ── Structured data (rich results) ───────────────────────────────────────────────────────────────────────

export type SchemaKind = "none" | "business" | "faq" | "article" | "custom";

export type BusinessFields = { name: string; kind: string; phone: string; email: string; url: string; image: string; street: string; city: string; region: string; postalCode: string; country: string; hours: string };
export type FaqRow = { question: string; answer: string };
export type ArticleFields = { headline: string; author: string; datePublished: string; image: string; description: string };

export const BUSINESS_KINDS: Array<{ value: string; label: string }> = [
  { value: "LocalBusiness", label: "Local business" },
  { value: "Organization", label: "Company or organisation" },
  { value: "Restaurant", label: "Restaurant or cafe" },
  { value: "Store", label: "Shop" },
  { value: "ProfessionalService", label: "Professional service" },
  { value: "HealthAndBeautyBusiness", label: "Salon, spa or clinic" },
  { value: "RealEstateAgent", label: "Estate agent" },
  { value: "LodgingBusiness", label: "Hotel or guesthouse" },
];

const clip = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const put = (o: Record<string, unknown>, k: string, v: unknown): void => {
  if (v !== "" && v !== undefined && v !== null) o[k] = v;
};

export function emptyBusiness(defaults: Partial<BusinessFields> = {}): BusinessFields {
  return { name: "", kind: "LocalBusiness", phone: "", email: "", url: "", image: "", street: "", city: "", region: "", postalCode: "", country: "", hours: "", ...defaults };
}

export function buildBusinessSchema(f: BusinessFields): Record<string, unknown> {
  const kind = BUSINESS_KINDS.some((k) => k.value === f.kind) ? f.kind : "LocalBusiness";
  const o: Record<string, unknown> = { "@context": "https://schema.org", "@type": kind };
  put(o, "name", clip(f.name, 120));
  put(o, "url", clip(f.url, 500));
  put(o, "image", clip(f.image, 500));
  put(o, "telephone", clip(f.phone, 40));
  put(o, "email", clip(f.email, 120));
  const address: Record<string, unknown> = { "@type": "PostalAddress" };
  put(address, "streetAddress", clip(f.street, 160));
  put(address, "addressLocality", clip(f.city, 80));
  put(address, "addressRegion", clip(f.region, 80));
  put(address, "postalCode", clip(f.postalCode, 20));
  put(address, "addressCountry", clip(f.country, 80));
  if (Object.keys(address).length > 1) o.address = address;
  // One line like "Mo-Fr 09:00-18:00" (Google's own format); several lines become several entries.
  const hours = f.hours.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 7);
  if (hours.length) o.openingHours = hours.length === 1 ? hours[0] : hours;
  return o;
}

export function buildFaqSchema(rows: FaqRow[]): Record<string, unknown> {
  const items = rows
    .map((r) => ({ q: clip(r.question, 300), a: clip(r.answer, 2000) }))
    .filter((r) => r.q && r.a)
    .slice(0, 30)
    .map((r) => ({ "@type": "Question", name: r.q, acceptedAnswer: { "@type": "Answer", text: r.a } }));
  return { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: items };
}

export function buildArticleSchema(f: ArticleFields): Record<string, unknown> {
  const o: Record<string, unknown> = { "@context": "https://schema.org", "@type": "Article" };
  put(o, "headline", clip(f.headline, 110));
  put(o, "description", clip(f.description, 300));
  put(o, "image", clip(f.image, 500));
  put(o, "datePublished", clip(f.datePublished, 40));
  if (clip(f.author, 120)) o.author = { "@type": "Person", name: clip(f.author, 120) };
  return o;
}

export const MAX_SCHEMA_CHARS = 20_000;
const MAX_ITEMS = 10;

export type SchemaCheck = { ok: boolean; /** The JSON that will be published (valid, schema.org, nothing but data). */ json: string; types: string[]; problems: string[]; tips: string[] };

const typesOf = (item: Record<string, unknown>): string[] => (Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]]).filter((t): t is string => typeof t === "string");

/**
 * Reads structured data an owner typed or pasted. Problems stop it being published ("fix this"); tips are only advice ("looks good, and
 * Google also likes ..."). Always returns plain-word messages. Accepts one item or a list, with or without "@context".
 */
export function checkSchemaJson(text: string): SchemaCheck {
  const bad = (problem: string): SchemaCheck => ({ ok: false, json: "", types: [], problems: [problem], tips: [] });
  const raw = (text ?? "").trim();
  if (!raw) return { ok: true, json: "", types: [], problems: [], tips: [] };
  if (raw.length > MAX_SCHEMA_CHARS) return bad("That is too long. Structured data should be under 20,000 characters.");
  // Pasted straight from a tutorial, it is usually wrapped in the script tag: take what is inside.
  const inner = /^<script[^>]*>([\s\S]*)<\/script>\s*$/i.exec(raw)?.[1] ?? raw;
  let parsed: unknown;
  try {
    parsed = JSON.parse(inner);
  } catch {
    return bad("This isn't valid JSON yet. Check for a missing comma, bracket or quote. A free checker like jsonlint.com can point at the exact spot.");
  }
  const items = (Array.isArray(parsed) ? parsed : [parsed]) as unknown[];
  if (items.length === 0) return bad("There is nothing in the list.");
  if (items.length > MAX_ITEMS) return bad(`Please keep it to ${MAX_ITEMS} items or fewer.`);
  const out: Record<string, unknown>[] = [];
  const types: string[] = [];
  const problems: string[] = [];
  const tips: string[] = [];
  items.forEach((item, i) => {
    const where = items.length > 1 ? `Item ${i + 1}: ` : "";
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      problems.push(`${where}this must be an object with an "@type".`);
      return;
    }
    const o = { ...(item as Record<string, unknown>) };
    const ctx = o["@context"];
    if (ctx === undefined) o["@context"] = "https://schema.org";
    else if (!JSON.stringify(ctx).toLowerCase().includes("schema.org")) {
      problems.push(`${where}"@context" should be "https://schema.org".`);
      return;
    }
    const t = typesOf(o);
    if (t.length === 0) {
      problems.push(`${where}it needs an "@type", like "LocalBusiness" or "FAQPage".`);
      return;
    }
    types.push(...t);
    out.push(o);
    if (t.includes("WebSite")) tips.push(`${where}Plexo already adds basic website details to every page, so you may not need this.`);
    if (t.includes("FAQPage")) {
      const q = Array.isArray(o.mainEntity) ? (o.mainEntity as Record<string, unknown>[]) : [];
      if (q.length === 0) problems.push(`${where}a FAQ needs at least one question under "mainEntity".`);
      else if (q.some((x) => !x || typeof x.name !== "string" || !(x.acceptedAnswer as { text?: unknown } | undefined)?.text)) problems.push(`${where}every question needs a "name" and an "acceptedAnswer" with "text".`);
    }
    if (t.some((x) => /Business|Organization|Restaurant|Store|Service|Agent|Lodging/.test(x))) {
      if (typeof o.name !== "string" || !o.name.trim()) problems.push(`${where}a business needs a "name".`);
      if (!o.address) tips.push(`${where}Add an address so Google can show where you are.`);
      if (!o.telephone) tips.push(`${where}Add a phone number so people can call you from the search result.`);
    }
    if (t.includes("Article") || t.includes("BlogPosting") || t.includes("NewsArticle")) {
      if (typeof o.headline !== "string" || !o.headline.trim()) problems.push(`${where}an article needs a "headline".`);
      if (!o.datePublished) tips.push(`${where}Add "datePublished" so Google can show the date.`);
    }
  });
  if (problems.length) return { ok: false, json: "", types: [...new Set(types)], problems, tips };
  return { ok: true, json: JSON.stringify(out.length === 1 ? out[0] : out), types: [...new Set(types)], problems: [], tips };
}

/** The pieces to publish for a page: each item of the saved JSON-LD, re-checked, so a hand-edited record can never inject anything. */
export function schemaItemsToPublish(saved: string): Record<string, unknown>[] {
  const c = checkSchemaJson(saved);
  if (!c.ok || !c.json) return [];
  const parsed = JSON.parse(c.json) as unknown;
  return (Array.isArray(parsed) ? parsed : [parsed]) as Record<string, unknown>[];
}
