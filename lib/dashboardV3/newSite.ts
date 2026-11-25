/**
 * "Make a new website" for the new dashboard: the fork (new site or move one), what it's for, a
 * name, three designs, then create. Pure logic only (no React, no database), tested in
 * tests/newSiteFlow.test.ts. The server path that builds the site is the one onboarding uses
 * (lib/onboarding/complete.ts siteCreateArgs -> site_create), so there is one way to make a site.
 */
import type { SolBuildGoal, SolBuildProfile } from "@/lib/ai/solBuildContext";
import { INDUSTRIES, STYLES } from "@/lib/onboarding/understandWords";
import { pickDesigns, type DesignChoice } from "@/lib/onboarding/designs";
import { siteCreateArgs } from "@/lib/onboarding/complete";
import { getTierFeatures } from "@/lib/subscription";
import { CURRENT_SITE_COOKIE } from "@/lib/dashboardV3/sites";
import { nextPlanUp, planLabel, toPlanId, PLAN } from "@/lib/plan/plans";
import { cleanLogo, parseSolPart, type SolPart } from "@/lib/onboarding/designEditRequest";

export const NEW_SITE_PATH = "/dashboard/sites/new";
export const DESIGNS_PATH = "/dashboard/marketplace";
export const MOVE_PATH = "/dashboard/migrate/wordpress";
export const UPLOAD_PATH = "/dashboard/templates/upload";
export const UPGRADE_PATH = "/dashboard/settings/subscription";

const solHref = (prompt: string) => `/dashboard/sol?new=1&draft=${encodeURIComponent(prompt)}`;

export type Start = "new" | "move";

/** The first screen's two big choices. Moving goes straight to the move (which makes the site itself): no placeholder site first. */
export const STARTS: { id: Start; title: string; text: string }[] = [
  { id: "new", title: "Start a new website", text: "Tell us what it is for and pick a look. Ready in about a minute." },
  { id: "move", title: "Already on WordPress or another editor?", text: "Move it to Plexo in a few minutes. We bring over your pages, posts and pictures." },
];

export type ForkStep = { kind: "goal" } | { kind: "go"; href: string };
export function afterFork(start: Start): ForkStep {
  return start === "move" ? { kind: "go", href: MOVE_PATH } : { kind: "goal" };
}

/** For people on Wix, Squarespace, Webflow and the rest, there is no importer yet: SOL rebuilds it with them. */
export const OTHER_EDITOR_HREF = solHref("I already have a website on another website builder. Help me rebuild it on Plexo. Ask me for its address and bring over what you can.");

export type NewSiteGoal = Exclude<SolBuildGoal, "explore">;
export const NEW_SITE_GOALS: { id: NewSiteGoal; title: string; text: string }[] = [
  { id: "store", title: "Sell products", text: "A shop with checkout and payments." },
  { id: "business-site", title: "Website for my business", text: "Home, about, services and contact." },
  { id: "blog", title: "Blog", text: "Share stories people can find on Google." },
  { id: "course", title: "Course", text: "Lessons people pay for and finish." },
  { id: "link-in-bio", title: "One link for all my links", text: "A simple page for your bio." },
  { id: "landing", title: "One page to promote something", text: "An event, a launch, one product." },
  { id: "app", title: "App people sign into", text: "Bookings, members, saved data. SOL builds it with you." },
];

export const isAppGoal = (goal: string): boolean => goal === "app";

/** Other ways to start. Moving a site is its own first choice now, so it is not here. */
export const MORE_WAYS: { id: string; title: string; href: string }[] = [
  { id: "upload", title: "Upload my own files", href: UPLOAD_PATH },
  { id: "app", title: "Build an app with SOL", href: solHref("I want to build an app people can sign into. Ask me what it should do, then build it.") },
  { id: "sol", title: "Build it with SOL", href: solHref("Build me a website. Ask me what it is for, then make it.") },
];

export const appHref = (name: string): string =>
  solHref(`Build me an app${name.trim() ? ` called "${name.trim()}"` : ""} that people can sign into. Ask me what it should do, then build it.`);

const clean = (v: string) => v.replace(/\s+/g, " ").trim();

const SUFFIX: Partial<Record<NewSiteGoal, string>> = { store: "Shop", blog: "Blog", course: "Academy", "link-in-bio": "Links", landing: "Launch" };

/** A name to start from: the owner's brand name, made different from their other sites when it is already taken. */
export function defaultSiteName(brandName: string | undefined, goal: NewSiteGoal | "", existing: string[]): string {
  const taken = new Set(existing.map((n) => clean(n).toLowerCase()));
  const base = clean(brandName ?? "");
  if (!base) {
    const first = goal === "store" ? "My shop" : goal === "blog" ? "My blog" : goal === "course" ? "My course" : "My website";
    return nameNotTaken(first, taken);
  }
  if (!taken.has(base.toLowerCase())) return base;
  const suffix = goal ? SUFFIX[goal] : undefined;
  return nameNotTaken(suffix ? `${base} ${suffix}` : base, taken);
}

function nameNotTaken(name: string, taken: Set<string>): string {
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; i < 100; i++) if (!taken.has(`${name} ${i}`.toLowerCase())) return `${name} ${i}`;
  return name;
}

/** What the designs and the site are made from: the owner's brand with this site's name on it. */
export function profileFor(goal: NewSiteGoal, name: string, brand: SolBuildProfile["brand"] | undefined, extra?: { about?: string; industry?: string; tone?: string; businessType?: string }): SolBuildProfile {
  const about = extra?.about ? clean(extra.about).slice(0, 500) : "";
  return {
    goal,
    brand: {
      ...(brand ?? {}),
      name: clean(name).slice(0, 80) || brand?.name || "My website",
      ...(about ? { about } : {}),
      // What SOL understood from the description (see lib/onboarding/understand.ts): steers which designs fit best.
      ...(extra?.industry ? { industry: extra.industry } : {}),
      ...(extra?.tone ? { tone: extra.tone } : {}),
      ...(extra?.businessType ? { businessType: extra.businessType } : {}),
    },
  };
}

export function designPicks(goal: NewSiteGoal, name: string, brand?: SolBuildProfile["brand"], extra?: { about?: string; industry?: string; tone?: string; businessType?: string }): { top: DesignChoice[]; total: number } {
  const { top, others } = pickDesigns(profileFor(goal, name, brand, extra));
  return { top, total: top.length + others.length };
}

/** Where Stripe brings someone back after paying for a marketplace design (the server only allows this exact page). */
export const MARKET_RETURN_PATH = NEW_SITE_PATH;
/** A just-paid design takes a moment to be recorded: ask again every 2 seconds, up to about 16 seconds. */
export const PAID_RETRY = { tries: 8, delayMs: 2000 } as const;
export const PENDING_KEY = "plexo-new-site";

export type PendingNewSite = { goal: NewSiteGoal; name: string };

/** What the owner had typed before leaving to pay, so the site is still made with their name and goal. */
export function readPending(raw: string | null | undefined): PendingNewSite | null {
  try {
    const v = JSON.parse(raw ?? "") as Partial<PendingNewSite>;
    const goal = NEW_SITE_GOALS.find((g) => g.id === v.goal && !isAppGoal(g.id))?.id;
    const name = typeof v.name === "string" ? clean(v.name).slice(0, 80) : "";
    return goal && name ? { goal, name } : null;
  } catch {
    return null;
  }
}

/** The design id Stripe's return puts in the address (?paidDesign=), or null. */
export function paidDesignFrom(search: string): string | null {
  const id = new URLSearchParams(search).get("paidDesign");
  return id && /^[\w-]{1,80}$/.test(id) ? id : null;
}

export type CreateRequest = { goal: NewSiteGoal; name: string; designId: string; marketDesignId?: string; personalizedHtml?: string; /** The design exactly as the owner saw it in the preview (their name, colour and description on it) when SOL did not rewrite it: this is what the site is made with. */ brandedHtml?: string; /** The colour the preview was recoloured to (#rrggbb), so the design's own colour data follows. */ brandColor?: string; /** What the owner said the website is for and should look like: shapes the design picked and the words on the site. */ about?: string; /** What SOL understood from it (only the allowed words). */ industry?: string; style?: string; /** A new-editor marketplace design: SOL's part of the personalization (its words by number, sections it removed, the kind of business, whether contact details were given). The design itself is rebuilt on the server from the listing; this is only the small recipe. */ designEdits?: SolPart; /** The logo the preview showed (an address), so the site keeps the same logo as the preview. */ brandLogoUrl?: string };

/** The most branded design HTML a create request carries (a design is well under this; anything bigger is left out rather than refused). */
export const MAX_BRANDED_HTML_CHARS = 2_000_000;

export function parseCreateRequest(body: unknown): { ok: true; value: CreateRequest } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const goal = NEW_SITE_GOALS.find((g) => g.id === b.goal && !isAppGoal(g.id))?.id;
  if (!goal) return { ok: false, error: "Pick what your website is for first." };
  const name = typeof b.name === "string" ? clean(b.name) : "";
  if (!name) return { ok: false, error: "Give your website a name, like your business name." };
  const market = typeof b.marketDesignId === "string" && b.marketDesignId.trim() ? b.marketDesignId.trim() : undefined;
  const personalizedHtml = typeof b.personalizedHtml === "string" && b.personalizedHtml.trim() ? b.personalizedHtml.trim() : undefined;
  const brandedHtml = typeof b.brandedHtml === "string" && b.brandedHtml.trim() && b.brandedHtml.length <= MAX_BRANDED_HTML_CHARS ? b.brandedHtml.trim() : undefined;
  const brandColor = typeof b.brandColor === "string" && /^#[0-9a-f]{6}$/i.test(b.brandColor.trim()) ? b.brandColor.trim() : undefined;
  const about = typeof b.about === "string" ? clean(b.about).slice(0, 500) : "";
  const industry = (INDUSTRIES as readonly string[]).find((i) => i === b.industry);
  const style = (STYLES as readonly string[]).find((i) => i === b.style);
  const designEdits = market && b.designEdits && typeof b.designEdits === "object" ? parseSolPart(b.designEdits) : undefined;
  const brandLogoUrl = cleanLogo(b.brandLogoUrl);
  return { ok: true, value: { goal, name: name.slice(0, 80), designId: typeof b.designId === "string" ? b.designId : "", ...(market ? { marketDesignId: market } : {}), ...(personalizedHtml ? { personalizedHtml } : {}), ...(brandedHtml ? { brandedHtml } : {}), ...(brandColor ? { brandColor } : {}), ...(about ? { about } : {}), ...(industry ? { industry } : {}), ...(style ? { style } : {}), ...(designEdits ? { designEdits } : {}), ...(brandLogoUrl ? { brandLogoUrl } : {}) } };
}

/** The arguments for site_create: the same ones onboarding builds. */
export function createArgs(req: CreateRequest, brand: SolBuildProfile["brand"] | undefined): Record<string, unknown> | null {
  return siteCreateArgs(profileFor(req.goal, req.name, brand, { about: req.about, industry: req.industry, tone: req.style }), req.designId);
}

export type LimitNote = { text: string; upgradeHref: string; upgradeLabel: string } | null;

/**
 * The plain-words heads-up when this plan can't have another site online. Building is never blocked:
 * a new site is always saved (private); the limit is how many are live (lib/plan/publishGuard.ts).
 */
export function limitNote(plan: string, liveSiteNames: string[], opts: { trial?: boolean } = {}): LimitNote {
  const max = getTierFeatures(plan, opts).maxPublishedSites;
  if (max === null || liveSiteNames.length < max) return null;
  const id = toPlanId(plan);
  const up = nextPlanUp(id);
  const upgradeLabel = up ? `See ${planLabel(up)}` : "See plans";
  const first = liveSiteNames[0];
  const text =
    id === PLAN.FREE
      ? `You can make this website now. The Free plan keeps one website online at a time, and "${first}" is online. This one stays private while you build it. To put it online, upgrade${up ? ` to ${planLabel(up)}` : ""} or switch which website is online (nothing is deleted).`
      : `You can make this website now. Your ${planLabel(plan)} plan keeps ${max} website${max === 1 ? "" : "s"} online at a time and ${max === 1 ? `"${first}" is` : "they are all"} online. This one stays private while you build it. To put it online, upgrade or take one offline first (nothing is deleted).`;
  return { text, upgradeHref: UPGRADE_PATH, upgradeLabel };
}

/** /dashboard/new for people on the new dashboard goes to the new flow; ?classic=1 keeps the old page. */
export function newSiteRedirect(opts: { newDashboard: boolean; classic?: string | string[] | null }): string | null {
  const classic = Array.isArray(opts.classic) ? opts.classic[0] : opts.classic;
  return opts.newDashboard && classic !== "1" ? NEW_SITE_PATH : null;
}

/** Set when a website is made: Home then shows that site's guided steps first (see homeMode), whichever view the person usually has. */
export const JUST_MADE_COOKIE = "plexo-just-made";

/**
 * Where the owner lands right after "Create my website": always the dashboard home, whether or not SOL personalized the site. Home
 * shows the new site's guided steps ("Review and edit your pages", "Finish up"...), so the next thing to do is always in front of
 * them, never a hub of tabs with no obvious next step.
 */
export function afterCreateHref(): string {
  return "/dashboard";
}

/**
 * Makes a site that was just created (made, uploaded or moved from WordPress) the owner's current site and flags it as just made, so
 * Home opens on its guided steps. Called by every route that creates a site the owner then lands on.
 */
export function markSiteJustMade(res: { cookies: { set: (name: string, value: string, opts: { path: string; maxAge: number; sameSite: "lax" }) => unknown } }, siteId: string): void {
  res.cookies.set(CURRENT_SITE_COOKIE, siteId, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  res.cookies.set(JUST_MADE_COOKIE, siteId, { path: "/", maxAge: 60 * 60 * 24 * 30, sameSite: "lax" });
}

/** Where a note about the new site waits for Home to show it (sessionStorage survives the move from this page to the dashboard). */
export const NEW_SITE_NOTICE_KEY = "plexo-new-site-notice";

export type NewSiteNotice = { siteId: string; messages: string[] };

/** The plain-words notes from a create response (`warnings`): only text, trimmed, no repeats, a handful. Anything else is dropped. */
export function noticeMessages(warnings: unknown): string[] {
  if (!Array.isArray(warnings)) return [];
  const out: string[] = [];
  for (const w of warnings) {
    const text = typeof w === "string" ? w.replace(/\s+/g, " ").trim().slice(0, 400) : "";
    if (text && !out.includes(text)) out.push(text);
  }
  return out.slice(0, 5);
}

/** What to keep for Home, or null when there is nothing to say. */
export function noticeFor(siteId: string, warnings: unknown): NewSiteNotice | null {
  const messages = noticeMessages(warnings);
  return siteId && messages.length ? { siteId, messages } : null;
}

/** Reads the saved note back; only when it belongs to the site Home is showing. */
export function readNotice(raw: string | null | undefined, siteId: string): NewSiteNotice | null {
  try {
    const v = JSON.parse(raw ?? "") as Partial<NewSiteNotice>;
    const messages = noticeMessages(v.messages);
    return v.siteId === siteId && messages.length ? { siteId, messages } : null;
  } catch {
    return null;
  }
}
