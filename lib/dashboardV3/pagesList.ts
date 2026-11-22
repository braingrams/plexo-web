/**
 * The Pages list (table) view: searching, filtering, sorting, "5 minutes ago" wording and the deep links into the
 * editor's Design / Code / Text views. Pure so it is tested once (tests/pagesList.test.ts).
 */
import type { HubPage } from "./hubData";

export type PagesViewMode = "cards" | "list";
export const PAGES_VIEW_KEY = "plexo.hub.pagesView";

export function readPagesView(): PagesViewMode {
  try {
    return window.localStorage.getItem(PAGES_VIEW_KEY) === "list" ? "list" : "cards";
  } catch {
    return "cards";
  }
}
export function savePagesView(view: PagesViewMode): void {
  try {
    window.localStorage.setItem(PAGES_VIEW_KEY, view);
  } catch {}
}

export type PageStatus = "published" | "draft";
export type StatusFilter = "all" | PageStatus;
export type PageSort = "title-asc" | "title-desc" | "updated-desc" | "updated-asc";

/**
 * What a page is called everywhere in the Pages area: "Home" for the first page, the page's own name for the rest.
 * (The home page is stored under the site's name, which made one entry look different from all the others.)
 */
export function pageLabel(p: Pick<HubPage, "name" | "isRoot">): string {
  return p.isRoot ? "Home" : p.name;
}

export function pageStatus(p: Pick<HubPage, "isPublished" | "archivedByPlan">): PageStatus {
  return p.isPublished && !p.archivedByPlan ? "published" : "draft";
}

/** Search matches the title or the address, ignoring case and a leading slash. */
export function filterPages(pages: HubPage[], query: string, status: StatusFilter): HubPage[] {
  const q = query.trim().toLowerCase().replace(/^\//, "");
  return pages.filter((p) => {
    if (status !== "all" && pageStatus(p) !== status) return false;
    if (!q) return true;
    return pageLabel(p).toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || p.path.toLowerCase().replace(/^\//, "").includes(q);
  });
}

export function sortPages(pages: HubPage[], sort: PageSort): HubPage[] {
  const out = [...pages];
  const byTitle = (a: HubPage, b: HubPage) => pageLabel(a).localeCompare(pageLabel(b), undefined, { sensitivity: "base", numeric: true });
  const byUpdated = (a: HubPage, b: HubPage) => (a.updatedAt ?? "").localeCompare(b.updatedAt ?? "");
  out.sort(sort === "title-asc" ? byTitle : sort === "title-desc" ? (a, b) => byTitle(b, a) : sort === "updated-asc" ? byUpdated : (a, b) => byUpdated(b, a));
  return out;
}

/** "Just now", "5 minutes ago", "Yesterday", "3 weeks ago" … — the exact time goes in the hover text. */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "—";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "Just now";
  const m = Math.round(s / 60);
  if (m < 60) return m === 1 ? "A minute ago" : `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? "An hour ago" : `${h} hours ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d} days ago`;
  const w = Math.round(d / 7);
  if (d < 30) return w === 1 ? "A week ago" : `${w} weeks ago`;
  const mo = Math.round(d / 30);
  if (d < 365) return mo === 1 ? "A month ago" : `${mo} months ago`;
  const y = Math.round(d / 365);
  return y === 1 ? "A year ago" : `${y} years ago`;
}

export function exactTime(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" });
}

export type EditView = "design" | "code" | "text";

/**
 * Every page can open as Code or Text except an app (it has its own editor). A page built with blocks is turned into code
 * the first time (the editor explains it and keeps a backup), after which it opens straight into that view.
 */
export function canEditAs(sourceType: HubPage["sourceType"], view: EditView): boolean {
  if (sourceType === "REACT_PROJECT") return view === "design";
  if (view === "design") return true;
  return sourceType === "RAW_UPLOAD" || sourceType === "BUILDER";
}

/** Where a row's "Edit" actions go. Design is the page's normal editor; Code and Text open the same page in that view. */
export function editViewHref(id: string, sourceType: HubPage["sourceType"], view: EditView): string {
  if (sourceType === "REACT_PROJECT") return `/dashboard/apps/${id}`;
  const base = `/dashboard/templates/${id}`;
  return view === "design" ? base : `${base}?mode=${view}`;
}

/** The ?mode= the editor was opened with. Anything else means "the page's normal view". */
export function parseEditMode(raw: string | string[] | null | undefined): EditView | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "code" || v === "text" || v === "design" ? v : null;
}

export function liveUrl(address: string | null, path: string): string | null {
  if (!address) return null;
  return `https://${address}${path === "/" ? "" : path}`;
}
