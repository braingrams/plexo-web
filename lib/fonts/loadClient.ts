import { FONT_PRECONNECT_TAGS, fontPreviewHref, fontStylesheetHref } from "./catalogue";

/** Loads fonts in the dashboard (browser only). Each stylesheet is added once; preconnect tags are added before the first. */
const added = new Set<string>();

function ensurePreconnect(): void {
  if (document.head.querySelector("link[data-plx-font-preconnect]")) return;
  const holder = document.createElement("div");
  holder.innerHTML = FONT_PRECONNECT_TAGS;
  for (const el of Array.from(holder.children)) {
    el.setAttribute("data-plx-font-preconnect", "");
    document.head.appendChild(el);
  }
}

function add(href: string | null): void {
  if (!href || added.has(href) || typeof document === "undefined") return;
  added.add(href);
  ensurePreconnect();
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

/** A font at the weights asked for, for showing the brand's real look. */
export const loadFontFamily = (name: string, weights: number[] = [400, 700]): void => add(fontStylesheetHref(name, weights));
/** Just enough of a font to show its own name in a list: a few KB, loaded only when the row is on screen. */
export const loadFontPreview = (name: string): void => add(fontPreviewHref(name));
