/**
 * (Pure part: no database. The part that gathers what Plexo already knows is in business.ts.)
 *
 * The business details behind Organization, LocalBusiness and Product markup.
 *
 * Nothing here is invented. Every value comes from something the owner already gave Plexo (the site's name, its logo,
 * the pickup address in shop settings, booking times, the phone, email and social links on their own page, their
 * products) or from the few details the owner types into the preview form. What the owner confirms is stored with the
 * site's health settings and used as it is, so serving a page never reads a database for it.
 */

export type BusinessAddress = { street?: string; city?: string; region?: string; postalCode?: string; country?: string };
export type OpeningHours = { days: number[]; opens: string; closes: string };
export type BusinessDetails = {
  /** "local": customers visit a place (LocalBusiness). "online": no place to visit (Organization). */
  kind?: "local" | "online";
  name?: string;
  phone?: string;
  email?: string;
  address?: BusinessAddress;
  hours?: OpeningHours[];
  logo?: string;
  sameAs?: string[];
};

const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, max) : undefined);
const httpsUrl = (v: unknown) => {
  const s = str(v, 500);
  if (!s) return undefined;
  try {
    const u = new URL(s);
    return u.protocol === "https:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
};
const time = (v: unknown) => (typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : undefined);

/** Only known fields, each trimmed and bounded: what the browser sends is never stored as it came. */
export function cleanBusiness(raw: unknown): BusinessDetails {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const a = r.address && typeof r.address === "object" ? (r.address as Record<string, unknown>) : {};
  const address: BusinessAddress = { street: str(a.street, 200), city: str(a.city, 100), region: str(a.region, 100), postalCode: str(a.postalCode, 20), country: str(a.country, 100) };
  const hours = (Array.isArray(r.hours) ? r.hours : []).flatMap((h): OpeningHours[] => {
    const o = h as Record<string, unknown>;
    const days = (Array.isArray(o?.days) ? o.days : []).filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6);
    const opens = time(o?.opens);
    const closes = time(o?.closes);
    return days.length && opens && closes ? [{ days: [...new Set(days)].sort(), opens, closes }] : [];
  });
  const phone = str(r.phone, 40)?.replace(/[^\d+()\-.\s]/g, "");
  const email = str(r.email, 200);
  const out: BusinessDetails = {
    kind: r.kind === "local" || r.kind === "online" ? r.kind : undefined,
    name: str(r.name, 120),
    phone: phone && /\d{5,}/.test(phone.replace(/\D/g, "")) ? phone : undefined,
    email: email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : undefined,
    address: Object.values(address).some(Boolean) ? address : undefined,
    hours: hours.length ? hours.slice(0, 14) : undefined,
    logo: httpsUrl(r.logo),
    sameAs: (Array.isArray(r.sameAs) ? r.sameAs : []).map(httpsUrl).filter((u): u is string => !!u).slice(0, 12),
  };
  if (!out.sameAs?.length) delete out.sameAs;
  return JSON.parse(JSON.stringify(out)) as BusinessDetails;
}

const SOCIAL = /^(www\.)?(facebook\.com|instagram\.com|x\.com|twitter\.com|linkedin\.com|youtube\.com|tiktok\.com|pinterest\.com|threads\.net|wa\.me)$/i;

/** What the owner's own page already says: phone and email links, and links to their social profiles. */
export function detectFromHtml(html: string): Pick<BusinessDetails, "phone" | "email" | "sameAs"> {
  const body = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ");
  const hrefs = [...body.matchAll(/<a\b[^>]*\bhref\s*=\s*"([^"]+)"/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
  const tel = hrefs.find((h) => /^tel:/i.test(h));
  const mail = hrefs.find((h) => /^mailto:/i.test(h));
  const sameAs = new Set<string>();
  for (const h of hrefs) {
    try {
      const u = new URL(h);
      // A profile, not a share button or the network's home page.
      if (u.protocol === "https:" && SOCIAL.test(u.hostname) && u.pathname.length > 1 && !/\/(sharer|share|intent|dialog)\b/i.test(u.pathname)) sameAs.add(`${u.origin}${u.pathname.replace(/\/$/, "")}`);
    } catch {
      // relative or odd link
    }
  }
  return {
    phone: tel ? decodeURIComponent(tel.slice(4)).split("?")[0].trim() || undefined : undefined,
    email: mail ? decodeURIComponent(mail.slice(7)).split("?")[0].trim() || undefined : undefined,
    sameAs: [...sameAs].slice(0, 8),
  };
}

/** Booking times become opening hours: days with the same hours are grouped; with several slots in a day, the earliest start to the latest end. */
export function hoursFromRules(rules: { dayOfWeek: number; startMinute: number; endMinute: number }[]): OpeningHours[] {
  const perDay = new Map<number, { s: number; e: number }>();
  for (const r of rules) {
    const cur = perDay.get(r.dayOfWeek);
    perDay.set(r.dayOfWeek, { s: Math.min(cur?.s ?? r.startMinute, r.startMinute), e: Math.max(cur?.e ?? r.endMinute, r.endMinute) });
  }
  const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const groups = new Map<string, OpeningHours>();
  for (const [day, { s, e }] of [...perDay].sort((a, b) => a[0] - b[0])) {
    const key = `${s}-${e}`;
    const g = groups.get(key) ?? { days: [], opens: hhmm(s), closes: hhmm(e) };
    g.days.push(day);
    groups.set(key, g);
  }
  return [...groups.values()];
}

export type Missing = { field: "address" | "phone" | "name"; label: string; why: string };

/** What a LocalBusiness listing still needs, said in plain words. An online business needs nothing beyond its name. */
export function missingDetails(b: BusinessDetails): Missing[] {
  const out: Missing[] = [];
  if (!b.name) out.push({ field: "name", label: "Your business name", why: "It is what search tools call you." });
  if (b.kind === "local") {
    if (!b.address?.street || !b.address?.city) out.push({ field: "address", label: "Your street address and town", why: "Google shows it on maps and in \"near me\" results." });
    if (!b.phone) out.push({ field: "phone", label: "A phone number", why: "People can call you straight from the results." });
  }
  return out;
}

/** A business with a street address and a phone or opening hours is a LocalBusiness; anything less stays an Organization (never half a listing). */
export function effectiveKind(b: BusinessDetails): "LocalBusiness" | "Organization" {
  return b.kind === "local" && b.address?.street && b.address?.city ? "LocalBusiness" : "Organization";
}

export function organizationJsonLd(b: BusinessDetails, ctx: { siteName: string; origin: string; description?: string | null }): Record<string, unknown> {
  const type = effectiveKind(b);
  const out: Record<string, unknown> = { "@context": "https://schema.org", "@type": type, name: b.name || ctx.siteName, url: ctx.origin };
  if (ctx.description) out.description = ctx.description;
  if (b.logo) out.logo = b.logo;
  if (b.email) out.email = b.email;
  if (b.phone) out.telephone = b.phone;
  if (b.sameAs?.length) out.sameAs = b.sameAs;
  if (b.address && type === "LocalBusiness") {
    out.address = { "@type": "PostalAddress", streetAddress: b.address.street, addressLocality: b.address.city, ...(b.address.region ? { addressRegion: b.address.region } : {}), ...(b.address.postalCode ? { postalCode: b.address.postalCode } : {}), ...(b.address.country ? { addressCountry: b.address.country } : {}) };
    if (b.hours?.length) out.openingHoursSpecification = b.hours.map((h) => ({ "@type": "OpeningHoursSpecification", dayOfWeek: h.days.map((d) => DAY[d]), opens: h.opens, closes: h.closes }));
  }
  return out;
}

export type ProductForMarkup = { name: string; description?: string | null; imageUrl?: string | null; sku?: string | null; priceMinor: number; currency?: string | null; stockQuantity?: number | null; kind?: string | null };

/** Product markup from the product's own record: price, stock, picture. A product with no price shown gets none (never a made-up one). */
export function productJsonLd(p: ProductForMarkup, ctx: { url: string; seller: string }): Record<string, unknown> {
  const inStock = p.kind === "SERVICE" || p.kind === "DIGITAL" || p.stockQuantity == null || p.stockQuantity > 0;
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    ...(p.description ? { description: p.description.replace(/\s+/g, " ").trim().slice(0, 500) } : {}),
    ...(p.imageUrl ? { image: [p.imageUrl] } : {}),
    ...(p.sku ? { sku: p.sku } : {}),
    offers: {
      "@type": "Offer",
      url: ctx.url,
      price: (p.priceMinor / 100).toFixed(2),
      priceCurrency: (p.currency || "NGN").toUpperCase(),
      availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      seller: { "@type": "Organization", name: ctx.seller },
    },
  };
}

