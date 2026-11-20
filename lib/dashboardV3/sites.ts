/**
 * The sites the v3 shell knows about, and which one a beginner is looking at (beginners see
 * one site at a time with a switcher; intermediate/pro see them all together — SPEC "After
 * You're live"). Pure.
 */
import type { SiteBrand } from "./brandLook";

export type SiteKindLabel = "Website" | "Online store" | "Blog" | "Course" | "App with sign-in" | "Server app" | "Uploaded app" | "Uploaded page" | "WordPress migrated site" | "Link page";

export type SiteSummary = {
  id: string;
  name: string;
  kind: SiteKindLabel;
  status: "live" | "draft";
  /** Where visitors see it, when it's live (e.g. "amaskitchen.plexopages.com"). */
  address?: string | null;
  updatedAt?: string | null;
  /** This site's own logo and colours (not the account default). */
  brand?: SiteBrand;
  /** The WordPress address this site was moved from, when it came from there. */
  movedFrom?: string;
};

export const CURRENT_SITE_COOKIE = "plexo-site";

/** The site to show: the one they last picked (cookie) if it still exists, else the most recently edited. */
export function pickCurrentSite(sites: SiteSummary[], cookieValue?: string | null): SiteSummary | null {
  if (!sites.length) return null;
  const picked = cookieValue ? sites.find((s) => s.id === cookieValue) : undefined;
  if (picked) return picked;
  return [...sites].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))[0];
}

export function siteKindOf(t: { sourceType?: string | null; isLmsFunnel?: boolean | null; hasStore?: boolean; hasBlog?: boolean; migratedFrom?: string | null }): SiteKindLabel {
  if (t.sourceType === "REACT_PROJECT") return "App with sign-in";
  if (t.isLmsFunnel) return "Course";
  // A site moved in from WordPress says so everywhere, whatever it is made of underneath.
  if (t.migratedFrom) return "WordPress migrated site";
  if (t.sourceType === "RAW_UPLOAD") return "Uploaded page";
  if (t.hasStore) return "Online store";
  if (t.hasBlog) return "Blog";
  return "Website";
}
