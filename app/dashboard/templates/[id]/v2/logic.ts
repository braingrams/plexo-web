import type { DesignSystem, PageDefinition } from "@charisol/plexo-sdk/v2/compile";

import { V2_FORMAT, type DesignSystemRef, type V2Design, type V2Meta } from "@/lib/v2/design";
import { formatMoney } from "@/lib/commerce/formatMoney";

// The decisions the template editor makes for a new-editor (V2) page, kept free of React so they
// can be tested: what a save sends, how the site's pages are listed, and "save first, then move".

export type TreePage = { id: string; name: string; slug: string | null; parentId: string | null; order: number; isPublished?: boolean };

/**
 * The body autosave and Save send to POST /api/templates/update/:id. The design system is only
 * included once the owner changed it (it is ~84 KB and the server falls back to the built-in one).
 */
export function buildV2SavePayload(input: {
  page: PageDefinition;
  designSystem?: DesignSystem;
  /**
   * True once the site's colours/fonts are customised (changed now, or already saved that way).
   * A save replaces the whole design on the server, so a customised system must travel with every
   * save; only the untouched built-in one (~84 KB) is left out and the server falls back to it.
   */
  includeDesignSystem: boolean;
  /** A big brand already in storage: the page is saved with this reference instead of carrying the brand itself. */
  designSystemRef?: DesignSystemRef;
  customJs?: string;
  meta?: V2Meta;
}): V2Design {
  const customJs = input.customJs?.trim() ? input.customJs : undefined;
  const meta = input.meta && Object.values(input.meta).some((v) => typeof v === "string" && v.trim()) ? input.meta : undefined;
  return {
    format: V2_FORMAT,
    pages: [input.page],
    ...(input.designSystemRef ? { designSystemRef: input.designSystemRef } : input.includeDesignSystem && input.designSystem ? { designSystem: input.designSystem } : {}),
    ...(customJs ? { customJs } : {}),
    ...(meta ? { meta } : {}),
  };
}

/** Saves the working copy; throws the server's plain-language message when it can't. */
export async function postV2Draft(templateId: string, design: V2Design, fetchFn: typeof fetch = fetch): Promise<void> {
  const res = await fetchFn(`/api/templates/update/${templateId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ designJson: design }),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? "Couldn't save this page. Your changes are still here, so try again.");
  }
}

/** "/", "/about", "/about/team": the address a page has on the site (the home page is the root row). */
export function routeOf(id: string, pages: TreePage[]): string {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const segments: string[] = [];
  let cursor = byId.get(id);
  while (cursor && cursor.parentId) {
    if (cursor.slug) segments.unshift(cursor.slug);
    cursor = byId.get(cursor.parentId);
  }
  return "/" + segments.join("/");
}

/** The editor's page list: the home page first, then the others in the order the owner arranged them. */
export function pageSourcePages(pages: TreePage[]): { id: string; name: string; route: string }[] {
  const children = new Map<string | null, TreePage[]>();
  for (const p of pages) children.set(p.parentId, [...(children.get(p.parentId) ?? []), p]);
  const out: TreePage[] = [];
  const walk = (parent: string | null) => {
    for (const p of (children.get(parent) ?? []).sort((a, b) => a.order - b.order)) {
      out.push(p);
      walk(p.id);
    }
  };
  walk(null);
  // A page whose parent isn't in the list still shows up rather than vanishing.
  for (const p of pages) if (!out.includes(p)) out.push(p);
  return out.map((p) => ({ id: p.id, name: p.name, route: routeOf(p.id, pages) }));
}

/** Save what's open before leaving it, and stay put if that save fails (nothing is lost silently). */
export async function leaveAfterSaving(opts: { dirty: boolean; save: () => Promise<void>; leave: () => void }): Promise<boolean> {
  if (opts.dirty) {
    try {
      await opts.save();
    } catch {
      return false;
    }
  }
  opts.leave();
  return true;
}

export function slugifyPageName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

/** What POST /api/templates gets for a new page in a new-editor site. */
export function newPageBody(input: { name: string; rootId: string; templateId: string }) {
  const name = input.name.trim() || "New page";
  return {
    name,
    parentId: input.rootId,
    slug: slugifyPageName(name),
    designFormat: "v2" as const,
    ...(input.templateId && input.templateId !== "blank" ? { pageTemplate: input.templateId } : {}),
  };
}

/**
 * The site's products as the editor's product picker lists them (picture, name, formatted price). Services are
 * left out — they're booked, not bought, so a "Buy now" card can't sell one. Rejects with a plain message the
 * picker shows as is.
 */
export async function productChoices(siteId: string): Promise<Array<{ id: string; name: string; priceLabel: string; imageUrl?: string; kind: string }>> {
  const res = await fetch(`/api/v1/commerce/${siteId}/products`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "We couldn't load your products.");
  return (data.products as Array<{ id: string; name: string; kind: string; priceMinor: number; currency: string; imageUrl?: string | null; active?: boolean }>)
    .filter((p) => p.active !== false && p.kind !== "SERVICE")
    .map((p) => ({ id: p.id, name: p.name, kind: p.kind, priceLabel: formatMoney(p.priceMinor, p.currency), ...(p.imageUrl ? { imageUrl: p.imageUrl } : {}) }));
}

export function stockProviders(keys: { unsplash?: string; pexels?: string; pixabay?: string }) {
  return [
    keys.unsplash ? { id: "unsplash", label: "Unsplash" } : null,
    keys.pexels ? { id: "pexels", label: "Pexels" } : null,
    keys.pixabay ? { id: "pixabay", label: "Pixabay" } : null,
  ].filter((p): p is { id: string; label: string } => !!p);
}

export const tryNewEditorKey = (templateId: string) => `plexo-try-v2-dismissed-${templateId}`;
