// Promo banners: the pure rules (no database, no React). SHARED CONTRACT: plexo-admin keeps a copy
// of this file (lib/promos/promos.ts, marked COPY) — WEB is the source of truth, change it here first.
//
// One slim strip at the top of the dashboard shows ONE promo: the highest-priority one that is on,
// inside its dates and not already closed by this person (for its current version).

export const PROMO_TONES = ["light", "dark", "brand"] as const;
export type PromoTone = (typeof PROMO_TONES)[number];

export const PROMO_FEATURE_IDS = ["move", "bookings", "sell", "blog", "course", "sol", "developers", "custom"] as const;
export type PromoFeatureId = (typeof PROMO_FEATURE_IDS)[number];

/**
 * Who a promo is for. "developers" = people with the pro view, an API key or an app. A developers promo
 * is shown only when no "all" promo is showing, and once someone closes it, it NEVER comes back for them
 * (editing its wording doesn't bring it back, unlike a normal promo).
 */
export const PROMO_AUDIENCES = ["all", "developers"] as const;
export type PromoAudience = (typeof PROMO_AUDIENCES)[number];
export const AUDIENCE_LABEL: Record<PromoAudience, string> = { all: "Everyone", developers: "For developers" };

/** The same message, as the always-there card in Settings > Developers. */
export const DEVELOPER_EDITOR_CARD = { title: "Use the Plexo editor in your own apps", body: "Drop the Plexo page editor into your own app with the SDK.", button: "See how" };

/** What the dashboard reads (and the admin edits). */
export type PromoRecord = {
  id: string;
  version: number;
  enabled: boolean;
  /** Lower number = shown first. */
  priority: number;
  feature: PromoFeatureId;
  /** Missing = "all". */
  audience?: PromoAudience;
  headline: string;
  body?: string;
  buttonLabel: string;
  href: string;
  imageUrl?: string;
  tone: PromoTone;
  startsAt?: string;
  endsAt?: string;
  clicks?: number;
  updatedAt?: string;
  updatedBy?: string;
};

export type PromoFeature = {
  id: PromoFeatureId;
  label: string;
  /** lucide icon name (the dashboard and the admin preview both map it). */
  icon: "ArrowRightLeft" | "CalendarCheck" | "ShoppingBag" | "PenLine" | "GraduationCap" | "MessageCircle" | "Megaphone" | "CodeXml";
  headline: string;
  body: string;
  buttonLabel: string;
  href: string;
  tone: PromoTone;
};

/** Picking a feature in the admin pre-fills these; everything stays editable. */
export const PROMO_FEATURES: PromoFeature[] = [
  { id: "move", label: "Move from WordPress or another builder", icon: "ArrowRightLeft", headline: "Already have a website elsewhere?", body: "Move it from WordPress or another editor in a few minutes. We do the heavy lifting.", buttonLabel: "Move my website", href: "/dashboard/settings/moving", tone: "brand" },
  { id: "bookings", label: "Take bookings", icon: "CalendarCheck", headline: "Let customers book you online", body: "Add a booking page to your website. SOL sets it up for you.", buttonLabel: "Add bookings", href: "/dashboard/sol?new=1&draft=Add%20online%20bookings%20to%20my%20website", tone: "light" },
  { id: "sell", label: "Sell products", icon: "ShoppingBag", headline: "Start selling on your website", body: "Add products, take payments and track orders in one place.", buttonLabel: "Start selling", href: "/dashboard/sol?new=1&draft=I%20want%20to%20sell%20products%20on%20my%20website", tone: "light" },
  { id: "blog", label: "Start a blog", icon: "PenLine", headline: "Share news with a blog", body: "Write posts that bring visitors back. No setup needed.", buttonLabel: "Start a blog", href: "/dashboard/blog", tone: "light" },
  { id: "course", label: "Start a course", icon: "GraduationCap", headline: "Teach what you know", body: "Turn your knowledge into a course people can sign up for.", buttonLabel: "Start a course", href: "/dashboard/learners", tone: "light" },
  { id: "sol", label: "Ask SOL", icon: "MessageCircle", headline: "Not sure where to start?", body: "Tell SOL what you want in your own words and it does the work.", buttonLabel: "Ask SOL", href: "/dashboard/sol?new=1", tone: "light" },
  { id: "developers", label: "Developers: use the editor in your own apps", icon: "CodeXml", headline: "Did you know you can use the Plexo Editor in your own apps?", body: "Drop the Plexo page editor into your own app with the SDK.", buttonLabel: "See how", href: "/dashboard/settings/developers", tone: "light" },
  { id: "custom", label: "Custom", icon: "Megaphone", headline: "", body: "", buttonLabel: "Learn more", href: "/dashboard", tone: "light" },
];

export function promoFeature(id: string): PromoFeature {
  return PROMO_FEATURES.find((f) => f.id === id) ?? PROMO_FEATURES[PROMO_FEATURES.length - 1];
}

/** The seed the admin sees before anyone saves anything: off, so the admin only has to switch it on. */
export const SEED_PROMO: PromoRecord = {
  id: "move-from-wordpress",
  version: 1,
  enabled: false,
  priority: 10,
  feature: "move",
  headline: "Already have a website elsewhere?",
  body: "Move it from WordPress or another editor in a few minutes. We do the heavy lifting.",
  buttonLabel: "Move my website",
  href: "/dashboard/settings/moving",
  tone: "brand",
  clicks: 0,
};

export const SEED_DEVELOPER_PROMO: PromoRecord = {
  id: "plexo-editor-for-developers",
  version: 1,
  enabled: false,
  priority: 90,
  feature: "developers",
  audience: "developers",
  headline: "Did you know you can use the Plexo Editor in your own apps?",
  body: "Drop the Plexo page editor into your own app with the SDK.",
  buttonLabel: "See how",
  href: "/dashboard/settings/developers",
  tone: "light",
  clicks: 0,
};

/** Ready-made promos the admin sees (all off) until they are saved for the first time. */
export const SEED_PROMOS: PromoRecord[] = [SEED_PROMO, SEED_DEVELOPER_PROMO];

export function promoAudience(p: Pick<PromoRecord, "audience">): PromoAudience {
  return p.audience === "developers" ? "developers" : "all";
}

/** Who counts as a developer (pure; the dashboard gathers the facts). */
export function isDeveloper(f: { experience?: string | null; apiKeyCount?: number; appCount?: number }): boolean {
  return f.experience === "pro" || (f.apiKeyCount ?? 0) > 0 || (f.appCount ?? 0) > 0;
}

/** Dashboard sections a promo may send people to. */
export const PROMO_INTERNAL_ROUTES = [
  "/dashboard", "/dashboard/sites", "/dashboard/new", "/dashboard/sol", "/dashboard/settings", "/dashboard/commerce",
  "/dashboard/blog", "/dashboard/learners", "/dashboard/emails", "/dashboard/domains", "/dashboard/migrate",
  "/dashboard/marketplace", "/dashboard/pages", "/dashboard/funnels", "/dashboard/insights", "/learn",
];

export const PROMO_LIMITS = { headline: 60, body: 120, buttonLabel: 24, href: 500 };

/** Where a promo's link is allowed to go. Returns an owner-friendly reason, or null when fine. */
export function validatePromoHref(raw: string): string | null {
  const href = raw.trim();
  if (!href) return "Add a link for the button.";
  if (href.length > PROMO_LIMITS.href) return "That link is too long.";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\s\\]/.test(href)) return "The link can't contain spaces or odd characters.";
  if (href.startsWith("/")) {
    if (href.startsWith("//")) return "Use a link that starts with one / (a dashboard page) or https://.";
    const path = href.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
    const ok = PROMO_INTERNAL_ROUTES.some((r) => path === r || path.startsWith(`${r}/`));
    return ok ? null : "That page isn't one of the dashboard pages a promo can open.";
  }
  try {
    const url = new URL(href);
    if (url.protocol !== "https:") return "Links to other websites must start with https://";
    if (!url.hostname.includes(".")) return "That web address doesn't look right.";
    return null;
  } catch {
    return "That link isn't valid. Use a dashboard page like /dashboard/blog or a full https:// address.";
  }
}

export function isExternalHref(href: string): boolean {
  return /^https:\/\//i.test(href);
}

/** Only https images (our own uploads) or relative ones. */
export function validatePromoImage(raw: string | undefined): string | null {
  if (!raw) return null;
  return /^https:\/\/[^\s]+$/.test(raw) && raw.length <= 1000 ? null : "The background image must be an uploaded picture.";
}

/** Whole-promo check used by the admin save (and the dashboard read, which drops anything invalid). */
export function validatePromo(p: Partial<PromoRecord>): string[] {
  const errors: string[] = [];
  const headline = (p.headline ?? "").trim();
  if (!headline) errors.push("Add a headline.");
  else if (headline.length > PROMO_LIMITS.headline) errors.push(`Keep the headline under ${PROMO_LIMITS.headline} characters.`);
  if ((p.body ?? "").trim().length > PROMO_LIMITS.body) errors.push(`Keep the line under ${PROMO_LIMITS.body} characters.`);
  const label = (p.buttonLabel ?? "").trim();
  if (!label) errors.push("Add a button label.");
  else if (label.length > PROMO_LIMITS.buttonLabel) errors.push(`Keep the button label under ${PROMO_LIMITS.buttonLabel} characters.`);
  const hrefError = validatePromoHref(p.href ?? "");
  if (hrefError) errors.push(hrefError);
  const imageError = validatePromoImage(p.imageUrl);
  if (imageError) errors.push(imageError);
  if (p.audience !== undefined && !(PROMO_AUDIENCES as readonly string[]).includes(p.audience)) errors.push("Pick who it is for.");
  if (!p.tone || !(PROMO_TONES as readonly string[]).includes(p.tone)) errors.push("Pick a look: light, dark or brand.");
  for (const [k, v] of [["start", p.startsAt], ["end", p.endsAt]] as const) {
    if (v && Number.isNaN(Date.parse(v))) errors.push(`The ${k} date isn't valid.`);
  }
  if (p.startsAt && p.endsAt && Date.parse(p.endsAt) <= Date.parse(p.startsAt)) errors.push("The end date must be after the start date.");
  return errors;
}

export type PromoStatus = "live" | "off" | "scheduled" | "ended";

export function promoStatus(p: Pick<PromoRecord, "enabled" | "startsAt" | "endsAt">, now: number = Date.now()): PromoStatus {
  if (!p.enabled) return "off";
  if (p.startsAt && Date.parse(p.startsAt) > now) return "scheduled";
  if (p.endsAt && Date.parse(p.endsAt) <= now) return "ended";
  return "live";
}

/** What a person has closed: promo id -> the version they closed. */
export type DismissedPromos = Record<string, number>;

export function readDismissed(stored: unknown): DismissedPromos {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  const out: DismissedPromos = {};
  for (const [k, v] of Object.entries(stored as Record<string, unknown>)) if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  return out;
}

/** Records the close; keeps only the newest 30 so the list never grows without bound. */
export function withDismissed(current: DismissedPromos, id: string, version: number): DismissedPromos {
  const next = { ...current, [id]: Math.max(version, current[id] ?? 0) };
  const keys = Object.keys(next);
  if (keys.length <= 30) return next;
  for (const k of keys.slice(0, keys.length - 30)) if (k !== id) delete next[k];
  return next;
}

/** Closed for this version (editing the promo bumps `version`, so people see the new message). */
export function isDismissed(p: Pick<PromoRecord, "id" | "version" | "audience">, dismissed: DismissedPromos): boolean {
  if (promoAudience(p) === "developers") return p.id in dismissed; // permanent: any version
  return (dismissed[p.id] ?? -1) >= p.version;
}

/** The one promo to show: highest priority (lowest number) that is live, valid and not closed. */
export function pickPromo(promos: PromoRecord[], dismissed: DismissedPromos, now: number = Date.now(), opts: { developer?: boolean } = {}): PromoRecord | null {
  return (
    [...promos]
      .filter((p) => promoStatus(p, now) === "live" && validatePromo(p).length === 0 && !isDismissed(p, dismissed) && (promoAudience(p) === "all" || opts.developer === true))
      // Promos for everyone come first; the developer one only fills the gap.
      .sort((a, b) => Number(promoAudience(a) === "developers") - Number(promoAudience(b) === "developers") || a.priority - b.priority || a.id.localeCompare(b.id))[0] ?? null
  );
}

/**
 * The promo to show one person. Promos for everyone win; a developer-only promo is a candidate when it is the best live
 * one, and only then is `isDev` asked. (Asking for "promos for everyone" first and giving up when there are none would
 * mean a lone developer promo never shows.)
 */
export async function choosePromo(promos: PromoRecord[], dismissed: DismissedPromos, now: number, isDev: () => Promise<boolean>): Promise<PromoRecord | null> {
  const candidate = pickPromo(promos, dismissed, now, { developer: true });
  if (!candidate || promoAudience(candidate) === "all") return candidate;
  return (await isDev()) ? candidate : pickPromo(promos, dismissed, now, { developer: false });
}

/** Pages where the strip stays out of the way: editors, SOL, onboarding, checkout and billing flows. */
export function promoHiddenOn(pathname: string, href?: string): boolean {
  const p = pathname.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  if (/^\/dashboard\/(templates|apps)\/[^/]+(\/|$)/.test(p) && p !== "/dashboard/templates/upload") return true;
  if (/^\/dashboard\/(sol|onboarding|welcome|choose-org)(\/|$)/.test(p)) return true;
  if (/(checkout|upgrade|subscription|billing|\/plan)(\/|$)/.test(p)) return true;
  if (/^\/dashboard\/(new|migrate)(\/|$)/.test(p)) return true;
  // Already on the page the button leads to.
  if (href && !isExternalHref(href) && (href.split(/[?#]/)[0].replace(/\/+$/, "") || "/") === p) return true;
  return false;
}

/** Position of one tone's classes: shared by the dashboard strip and the admin preview. */
export function promoClasses(tone: PromoTone, hasImage: boolean): string {
  return ["plx-promo", `plx-promo--${tone}`, hasImage ? "plx-promo--image" : ""].filter(Boolean).join(" ");
}
