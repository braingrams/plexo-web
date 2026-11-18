/**
 * How the hub presents things for each kind of owner: which Products view opens, where "Manage pages" lives, and the
 * small page-ordering helpers. Pure so the rules are tested once (tests/hubView.test.ts).
 */
import type { Experience } from "./nav";

export type ProductsView = "simple" | "full";
export const PRODUCTS_VIEW_KEY = "plexo.hub.productsView";

/** Pros open the full product tools; everyone else starts simple. A choice they made before always wins. */
export function resolveProductsView(experience: Experience, stored: unknown): ProductsView {
  if (stored === "simple" || stored === "full") return stored;
  return experience === "pro" ? "full" : "simple";
}

export function readProductsView(experience: Experience): ProductsView {
  try {
    return resolveProductsView(experience, window.localStorage.getItem(PRODUCTS_VIEW_KEY));
  } catch {
    return resolveProductsView(experience, null);
  }
}
export function saveProductsView(view: ProductsView): void {
  try {
    window.localStorage.setItem(PRODUCTS_VIEW_KEY, view);
  } catch {}
}

/** Pros see the page tools in a list that is always there; everyone else opens them with a button when they want them. */
export function managePagesMode(experience: Experience): "always" | "on-demand" {
  return experience === "pro" ? "always" : "on-demand";
}

export type TreePage = { id: string; name: string; parentId: string | null; order: number; isRoot: boolean };
export type OrderedPage<T extends TreePage> = T & { depth: number; siblingIndex: number; siblingCount: number };

/** Pages in the order a visitor's menu would list them: home first, then each page followed by the pages inside it. */
export function orderedPages<T extends TreePage>(pages: T[]): OrderedPage<T>[] {
  const root = pages.find((p) => p.isRoot);
  const kids = new Map<string | null, T[]>();
  for (const p of pages) {
    if (p.isRoot) continue;
    const key = p.parentId ?? root?.id ?? null;
    kids.set(key, [...(kids.get(key) ?? []), p]);
  }
  for (const list of kids.values()) list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const out: OrderedPage<T>[] = [];
  const walk = (parent: string | null, depth: number) => {
    const list = kids.get(parent) ?? [];
    list.forEach((p, i) => {
      out.push({ ...p, depth, siblingIndex: i, siblingCount: list.length });
      walk(p.id, depth + 1);
    });
  };
  if (root) out.push({ ...root, depth: 0, siblingIndex: 0, siblingCount: 1 });
  walk(root?.id ?? null, root ? 0 : 0);
  return out;
}

/** The new `order` numbers when `id` moves one place up (-1) or down (1) among its siblings; null when it can't move. */
export function movePage<T extends TreePage>(pages: T[], id: string, dir: -1 | 1): { id: string; order: number }[] | null {
  const page = pages.find((p) => p.id === id);
  if (!page || page.isRoot) return null;
  const root = pages.find((p) => p.isRoot);
  const parent = page.parentId ?? root?.id ?? null;
  const siblings = pages.filter((p) => !p.isRoot && (p.parentId ?? root?.id ?? null) === parent).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const at = siblings.findIndex((p) => p.id === id);
  const to = at + dir;
  if (at < 0 || to < 0 || to >= siblings.length) return null;
  const next = [...siblings];
  [next[at], next[to]] = [next[to], next[at]];
  return next.map((p, i) => ({ id: p.id, order: i })).filter((u) => siblings.find((s) => s.id === u.id)!.order !== u.order);
}

/** The ending of a page's address: lowercase letters, numbers and dashes. */
export function cleanPathPart(input: string): string {
  return input.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

/** A plain sentence when the typed address can't work, else null. */
export function pathProblem(input: string, siblings: { slug: string | null }[], currentSlug: string | null): string | null {
  const clean = cleanPathPart(input);
  if (!clean) return "Type a few letters or words for the address, like “about-us”.";
  if (clean !== currentSlug && siblings.some((s) => s.slug === clean)) return "Another page already uses that address. Try a different one.";
  return null;
}

export function deletePageMessage(name: string, isRoot: boolean, hasInside: boolean): string {
  if (isRoot) return `Delete the whole site "${name}"? Every page on it will be gone and visitors will no longer see it.`;
  return `Delete "${name}"? Visitors will no longer see it${hasInside ? ", and the pages inside it will go too" : ""}. This can't be undone.`;
}
