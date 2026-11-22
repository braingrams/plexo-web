/**
 * The pure rules behind the Products tab: paging, which layout the owner prefers, "select several", the stock badge
 * and the picture gallery order. No React, so each rule is tested once (tests/productList.test.ts).
 */

/* ------------------------------------------------------------------ paging */

export const PRODUCTS_PAGE_SIZE = 12;

export type Paged<T> = { items: T[]; page: number; pages: number; total: number; from: number; to: number };

/** One page of a list. A page number that is too big or small is pulled back in range (e.g. after hiding the last one on a page). */
export function paginate<T>(list: T[], page: number, pageSize = PRODUCTS_PAGE_SIZE): Paged<T> {
  const size = Math.max(1, Math.floor(pageSize));
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(pages, Math.max(1, Math.floor(Number.isFinite(page) ? page : 1)));
  const start = (p - 1) * size;
  const items = list.slice(start, start + size);
  return { items, page: p, pages, total, from: total ? start + 1 : 0, to: start + items.length };
}

/* ------------------------------------------------------------------ grid or list */

export type ProductsLayout = "grid" | "list";
export const PRODUCTS_LAYOUT_KEY = "plexo.hub.productsLayout";

/** Grid by default (a shop is something you look at); the owner's own choice always wins. */
export function resolveProductsLayout(stored: unknown): ProductsLayout {
  return stored === "list" || stored === "grid" ? stored : "grid";
}
export function readProductsLayout(): ProductsLayout {
  try {
    return resolveProductsLayout(window.localStorage.getItem(PRODUCTS_LAYOUT_KEY));
  } catch {
    return "grid";
  }
}
export function saveProductsLayout(layout: ProductsLayout): void {
  try {
    window.localStorage.setItem(PRODUCTS_LAYOUT_KEY, layout);
  } catch {}
}

/* ------------------------------------------------------------------ select several */

/** Adds the id if it is not chosen, removes it if it is. */
export function toggleId(chosen: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(chosen);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export type PageSelection = "none" | "some" | "all";
export function pageSelection(chosen: ReadonlySet<string>, pageIds: string[]): PageSelection {
  const n = pageIds.filter((id) => chosen.has(id)).length;
  return n === 0 ? "none" : n === pageIds.length ? "all" : "some";
}

/** "Select all on this page": if every product on the page is chosen, clear them; otherwise choose them all. Other pages are left alone. */
export function togglePage(chosen: ReadonlySet<string>, pageIds: string[]): Set<string> {
  const next = new Set(chosen);
  if (pageSelection(chosen, pageIds) === "all") for (const id of pageIds) next.delete(id);
  else for (const id of pageIds) next.add(id);
  return next;
}

/** Keeps only ids that still exist (a product that was deleted or filtered away can't stay chosen). */
export function pruneSelection(chosen: ReadonlySet<string>, existing: string[]): Set<string> {
  const keep = new Set(existing);
  return new Set([...chosen].filter((id) => keep.has(id)));
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* ------------------------------------------------------------------ stock badge */

type Stocked = { kind: string; stockQuantity?: number | null };

/**
 * What the list shows for stock: a badge of In stock / Out of stock, and the count when we keep one.
 * Only things you ship can run out; downloads, services and uncounted products are always "In stock".
 */
export function stockInfo(p: Stocked): { soldOut: boolean; badge: "In stock" | "Out of stock"; count: number | null } {
  const counted = p.kind === "PHYSICAL" && p.stockQuantity != null;
  const soldOut = counted && (p.stockQuantity as number) <= 0;
  return { soldOut, badge: soldOut ? "Out of stock" : "In stock", count: counted ? Math.max(0, p.stockQuantity as number) : null };
}

/* ------------------------------------------------------------------ pictures */

/** One ordered list of pictures: the first is the cover people see in the shop, the rest are its gallery. */
export function joinImages(cover: string | null | undefined, gallery: string[] | null | undefined): string[] {
  const seen = new Set<string>();
  return [cover ?? "", ...(gallery ?? [])].filter((u) => {
    if (!u || seen.has(u)) return false;
    seen.add(u);
    return true;
  });
}
export function splitImages(images: string[]): { imageUrl: string; galleryImageUrls: string[] } {
  return { imageUrl: images[0] ?? "", galleryImageUrls: images.slice(1) };
}
/** Moves a picture one place earlier (-1) or later (1). Moving it to the front makes it the cover. */
export function moveImage(images: string[], index: number, dir: -1 | 1): string[] {
  const to = index + dir;
  if (index < 0 || index >= images.length || to < 0 || to >= images.length) return images;
  const next = [...images];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}
export function makeCover(images: string[], index: number): string[] {
  if (index <= 0 || index >= images.length) return images;
  return [images[index], ...images.slice(0, index), ...images.slice(index + 1)];
}
export function removeImage(images: string[], index: number): string[] {
  return images.filter((_, i) => i !== index);
}
export const MAX_PRODUCT_IMAGES = 10;

/* ------------------------------------------------------------------ products often bought together */

export const MAX_RELATED = 3;
/** Adds or removes a product from "sold together", never more than three. */
export function toggleRelated(ids: string[], id: string): string[] {
  if (ids.includes(id)) return ids.filter((x) => x !== id);
  return ids.length >= MAX_RELATED ? ids : [...ids, id];
}
