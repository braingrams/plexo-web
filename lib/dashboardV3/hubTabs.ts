/**
 * Which tabs a site's hub shows, and which "Add more to your site" cards are offered
 * (docs/redesign/SPEC.md "Site hub"). Pure — the hub page feeds it what the site uses.
 */
import type { Experience } from "./nav";
import type { SiteKindLabel } from "./sites";

export type HubTabId = "app" | "pages" | "products" | "orders" | "shop" | "blog" | "course" | "brand" | "address" | "visits" | "health" | "settings" | "advanced";

export type HubFeatures = {
  store: boolean;
  donations?: boolean;
  blog: boolean;
  course: boolean;
  /** A server app with sign-in (React project). */
  app: boolean;
  /** Pages the owner brought as their own code. */
  ownCode: boolean;
  /** An app Plexo hosts from the owner's own code: "server" runs on a server, "static" is plain files. Replaces Pages with an App tab. */
  deployed?: "server" | "static" | null;
  /** Moved in from WordPress. */
  migrated?: boolean;
};

export const NO_FEATURES: HubFeatures = { store: false, blog: false, course: false, app: false, ownCode: false, deployed: null };

export type HubTab = { id: HubTabId; label: string; tour: string };

const TAB_LABELS: Record<HubTabId, string> = {
  app: "App",
  pages: "Pages",
  products: "Products",
  orders: "Orders",
  shop: "Shop",
  blog: "Blog",
  course: "Course",
  brand: "Brand",
  address: "Web address",
  visits: "Visits",
  health: "Site health",
  settings: "Settings",
  advanced: "Advanced",
};

export const HUB_TAB_IDS = Object.keys(TAB_LABELS) as HubTabId[];

export function parseHubTab(value: unknown): HubTabId | null {
  return typeof value === "string" && (HUB_TAB_IDS as string[]).includes(value) ? (value as HubTabId) : null;
}

/** Tabs only for what the site uses; everyone gets Visits and Site health, pros also get Advanced. */
export function hubTabs(features: HubFeatures, experience: Experience = "beginner"): HubTab[] {
  if (features.deployed) {
    // Only what works for hosted code: its own App tab, a web address, visits for pros, and settings.
    const own: HubTabId[] = ["app", "address", "visits", "health"];
    own.push("settings");
    if (experience === "pro") own.push("advanced");
    return own.map((id) => ({ id, label: TAB_LABELS[id], tour: `hub-tab-${id}` }));
  }
  const ids: HubTabId[] = ["pages"];
  if (features.store) ids.push("products", "orders", "shop");
  if (features.blog) ids.push("blog");
  if (features.course) ids.push("course");
  ids.push("brand", "address");
  // Visits (with the Google Analytics connection) and Site health are for everyone: knowing how a site is doing is the point.
  ids.push("visits", "health", "settings");
  // Everything a pro used to find on the old per-site page, right here (lib/dashboardV3/hubAdvanced.ts).
  if (experience === "pro") ids.push("advanced");
  return ids.map((id) => ({ id, label: TAB_LABELS[id], tour: `hub-tab-${id}` }));
}

/** The tab to show for `?tab=`: the one asked for if this site has it, else Pages. */
export function resolveHubTab(requested: unknown, features: HubFeatures, experience: Experience = "beginner"): HubTabId {
  const wanted = parseHubTab(requested);
  const tabs = hubTabs(features, experience);
  return wanted && tabs.some((t) => t.id === wanted) ? wanted : tabs[0].id;
}

export function hubTabHref(siteId: string, tab: HubTabId): string {
  return tab === "pages" ? `/dashboard/sites/${siteId}` : `/dashboard/sites/${siteId}?tab=${tab}`;
}

/** The plain label for what this site is (a store beats a blog; an app or course beats both). */
export function hubKindLabel(f: HubFeatures): SiteKindLabel {
  if (f.deployed === "server") return "Server app";
  if (f.deployed === "static") return "Uploaded app";
  if (f.app) return "App with sign-in";
  if (f.course) return "Course";
  if (f.migrated) return "WordPress migrated site";
  if (f.store) return "Online store";
  if (f.blog) return "Blog";
  return "Website";
}

export type AddOnId = "blog" | "course" | "bookings" | "newsletter" | "store";
export type AddOn = { id: AddOnId; title: string; body: string; action: string };

const ADD_ONS: AddOn[] = [
  { id: "store", title: "Sell products", body: "Take payments for things you make or do. We set up the shop, basket and checkout.", action: "Start selling" },
  { id: "blog", title: "A blog", body: "Share news and stories. We set up a place for your posts.", action: "Add a blog" },
  { id: "course", title: "A course", body: "Teach lessons to people who sign up.", action: "Add a course" },
  { id: "bookings", title: "Bookings", body: "Let people book a time with you and pay for it.", action: "Take bookings" },
  { id: "newsletter", title: "Email sign-up", body: "Collect emails so you can reach people later.", action: "Add sign-up form" },
];

/** Cards for things this site doesn't have yet. Apps manage their own features through SOL, so they get none. */
export function addOnsFor(features: HubFeatures): AddOn[] {
  if (features.app) return [];
  return ADD_ONS.filter((a) => {
    if (a.id === "store" || a.id === "bookings") return !features.store;
    if (a.id === "blog") return !features.blog;
    if (a.id === "course") return !features.course;
    return true;
  });
}

/** Pages Plexo sets up for a shop; the owner doesn't have to touch them. */
const SYSTEM_SLUGS = new Set(["shop", "store", "checkout", "order-confirmation", "track-order", "product"]);

export type PageNoteInput = { slug: string | null; isRoot: boolean; isPublished: boolean; archivedByPlan: boolean; storeOn: boolean; ownCode: boolean };

export function pageNote(p: PageNoteInput): string | null {
  if (p.archivedByPlan) return "Saved, not live on your plan";
  if (!p.isPublished) return "Draft";
  if (p.storeOn && p.slug && SYSTEM_SLUGS.has(p.slug)) return "Made for you";
  if (p.isRoot) return "Your home page";
  if (p.ownCode) return "Your own code";
  return null;
}

/** "About us" → "about-us" (only for showing a path; the server makes the real one unique). */
export function pagePath(slugs: string[]): string {
  return "/" + slugs.join("/");
}

export function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}
