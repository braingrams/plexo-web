/**
 * What the "Add more to your site" dialogs show, in the site's own words: the pages it has today
 * and what it will have after, so it's clear the feature joins THIS website instead of making a new one.
 * Pure; the paths match what each feature really creates (lib/commerce/storefrontLayout.ts, the blog's /blog).
 */
import type { AddOnId } from "./hubTabs";

export type ExamplePage = { name: string; path: string };

export type AddMoreExample = {
  /** "Your pages today: Home, About, Contact" (or null when the site has none yet). */
  today: string | null;
  /** The new addresses this adds, e.g. ["/store", "/store/checkout"]. Empty when it adds no pages. */
  adds: string[];
  /** One plain sentence tying it together. */
  summary: string;
};

const ADDS: Record<AddOnId, string[]> = {
  store: ["/store", "/store/checkout", "/order-confirmation", "/track-order"],
  bookings: ["/store", "/store/checkout", "/order-confirmation"],
  donations: ["/order-confirmation"],
  blog: ["/blog"],
  course: [],
  newsletter: [],
};

const MAX_NAMES = 6;

export function pagesToday(pages: ExamplePage[]): string | null {
  if (!pages.length) return null;
  const names = pages.map((p) => p.name.trim()).filter(Boolean);
  const shown = names.slice(0, MAX_NAMES).join(", ");
  return names.length > MAX_NAMES ? `${shown} and ${names.length - MAX_NAMES} more` : shown;
}

export function addMoreExample(id: AddOnId, siteName: string, pages: ExamplePage[]): AddMoreExample {
  const have = new Set(pages.map((p) => p.path.replace(/\/+$/, "") || "/"));
  // A page you already made at that address is kept and used, never replaced.
  const adds = ADDS[id].filter((p) => !have.has(p));
  const kept = ADDS[id].filter((p) => have.has(p));
  const today = pagesToday(pages);
  let summary: string;
  if (id === "course") summary = `This stays on "${siteName}". Your home page becomes the sign-up page and your other pages stay as they are.`;
  else if (id === "newsletter") summary = `The sign-up form goes onto one of the pages you already have on "${siteName}". Nothing new is created.`;
  else if (id === "donations") summary = `This is added to "${siteName}". Supporters can give by card or bank transfer, and bank donors see account details on a confirmation page.`;
  else {
    const addsText = adds.length ? `you'll also have ${adds.slice(0, 2).join(" and ")}${adds.length > 2 ? " and a few more" : ""}` : "your existing pages are used";
    summary = `This is added to "${siteName}", the same website, not a new one. After setup ${addsText}.`;
    if (kept.length) summary += ` Your own ${kept[0]} page is kept as it is.`;
  }
  return { today, adds, summary };
}
