// Loads the price book (lib/billing/pricing.ts) that plexo-admin edits.
//
// Screens read it through a short in-memory cache (PRICE_BOOK_TTL_MS) — an admin save shows
// everywhere within a minute without a deploy. Checkout reads it fresh (`{ fresh: true }`), so
// what a person is charged always matches the latest saved prices. If the stored book is
// missing, unreadable or invalid, the built-in DEFAULT_PRICE_BOOK is used — prices never vanish.

import { PriceBookRecord } from "@/lib/db/coreEntities";
import { DEFAULT_PRICE_BOOK, validatePriceBook, type PriceBook, type PriceGroup } from "./pricing";

export const PRICE_BOOK_TTL_MS = 60_000;

let cache: { at: number; book: PriceBook } | null = null;

/** Turns a stored row into a PriceBook, or null when it's not usable. */
export function priceBookFromRecord(row: { version?: number; defaultGroupId?: string; groups?: unknown; updatedAt?: string; updatedBy?: string } | null | undefined): PriceBook | null {
  if (!row || !Array.isArray(row.groups) || !row.defaultGroupId) return null;
  const book: PriceBook = {
    version: row.version ?? 0,
    defaultGroupId: row.defaultGroupId,
    groups: row.groups as PriceGroup[],
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
  const errors = validatePriceBook(book);
  if (errors.length) {
    console.error("[price book] stored price book is invalid — using the built-in defaults:", errors.slice(0, 5));
    return null;
  }
  return book;
}

export async function loadPriceBook(opts: { fresh?: boolean } = {}): Promise<PriceBook> {
  if (!opts.fresh && cache && Date.now() - cache.at < PRICE_BOOK_TTL_MS) return cache.book;
  let book: PriceBook = DEFAULT_PRICE_BOOK;
  try {
    const { data } = await PriceBookRecord.get({ id: "current" }).go();
    book = priceBookFromRecord(data) ?? DEFAULT_PRICE_BOOK;
  } catch (err) {
    console.error("[price book] couldn't load — using the cached or built-in prices", err);
    if (cache) return cache.book;
  }
  cache = { at: Date.now(), book };
  return book;
}

/** Drops this server's cached copy (after a write made from this app, and in tests). */
export function invalidatePriceBookCache(): void {
  cache = null;
}
