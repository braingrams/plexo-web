/**
 * "Which page do you want to change?" — turns a site's page tree into a flat, friendly list (Home first, then the rest in
 * the order the owner arranged them, sub-pages after their parent) and searches it. Pure so it is tested once.
 */
import { editHrefFor } from "./hubPaths";

export type PickablePage = { id: string; name: string; slug?: string | null; parentId?: string | null; order?: number | null; sourceType?: string | null };
export type PageChoice = { id: string; label: string; path: string; isHome: boolean; depth: number; href: string };

export function buildPageChoices(pages: PickablePage[], rootId: string): PageChoice[] {
  const byParent = new Map<string, PickablePage[]>();
  for (const p of pages) {
    if (p.id === rootId) continue;
    const key = p.parentId ?? rootId;
    byParent.set(key, [...(byParent.get(key) ?? []), p]);
  }
  const out: PageChoice[] = [];
  const seen = new Set<string>();
  const walk = (parentId: string, depth: number, prefix: string) => {
    const kids = [...(byParent.get(parentId) ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
    for (const p of kids) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      const path = `${prefix}/${p.slug ?? ""}`.replace(/\/+$/, "") || "/";
      out.push({ id: p.id, label: p.name || "Untitled page", path, isHome: false, depth, href: editHrefFor(p.id, p.sourceType) });
      walk(p.id, depth + 1, path === "/" ? "" : path);
    }
  };
  const root = pages.find((p) => p.id === rootId);
  out.push({ id: rootId, label: "Home", path: "/", isHome: true, depth: 0, href: editHrefFor(rootId, root?.sourceType) });
  seen.add(rootId);
  walk(rootId, 0, "");
  return out;
}

/** Matches the page's name or its address, ignoring case and a leading slash. */
export function searchPageChoices(choices: PageChoice[], query: string): PageChoice[] {
  const q = query.trim().toLowerCase().replace(/^\//, "");
  if (!q) return choices;
  return choices.filter((c) => c.label.toLowerCase().includes(q) || (c.isHome && "home".includes(q)) || c.path.toLowerCase().replace(/^\//, "").includes(q));
}
