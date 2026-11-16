/**
 * The sites the v3 shell knows about, and which one a beginner is looking at (beginners see
 * one site at a time with a switcher; intermediate/pro see them all together — SPEC "After
 * You're live"). Pure.
 */
export type SiteKindLabel = "Website" | "Online store" | "Blog" | "Course" | "App with sign-in" | "Server app" | "Uploaded app" | "Link page";

export type SiteSummary = {
  id: string;
  name: string;
  kind: SiteKindLabel;
  status: "live" | "draft";
  /** Where visitors see it, when it's live (e.g. "amaskitchen.plexopages.com"). */
  address?: string | null;
  updatedAt?: string | null;
};

export const CURRENT_SITE_COOKIE = "plexo-site";

/** The site to show: the one they last picked (cookie) if it still exists, else the most recently edited. */
export function pickCurrentSite(sites: SiteSummary[], cookieValue?: string | null): SiteSummary | null {
  if (!sites.length) return null;
  const picked = cookieValue ? sites.find((s) => s.id === cookieValue) : undefined;
  if (picked) return picked;
  return [...sites].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))[0];
}

export function siteKindOf(t: { sourceType?: string | null; isLmsFunnel?: boolean | null; hasStore?: boolean; hasBlog?: boolean }): SiteKindLabel {
  if (t.sourceType === "REACT_PROJECT") return "App with sign-in";
  if (t.isLmsFunnel) return "Course";
  if (t.hasStore) return "Online store";
  if (t.hasBlog) return "Blog";
  return "Website";
}
