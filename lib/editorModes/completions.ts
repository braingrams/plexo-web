/**
 * What the Code view suggests while typing: the site's design tokens (CSS variables from Strata, the same names
 * get_strata_tokens returns), Plexo's ready-made parts (shop, forms, newsletter...) and common class names — plus every
 * class the page already uses. Pure data + small matchers here; the CodeMirror glue is in codeCompletions.ts.
 */
import { DEFAULT_BRAND_TOKENS, SEMANTIC_ALIASES, SHARED_TOKENS } from "@/lib/brandTokens";

export type Suggestion = { label: string; detail?: string; /** snippet template (with ${} fields) */ apply?: string };

/** The token names the site can use, with their current value when known. `site` is the brand the site really uses. */
export function tokenSuggestions(site?: Record<string, string> | null): Suggestion[] {
  const values: Record<string, string> = { ...SHARED_TOKENS, ...DEFAULT_BRAND_TOKENS.light, ...(site ?? {}) };
  const out: Suggestion[] = Object.keys(values).map((k) => ({ label: `--${k}`, detail: values[k].length > 40 ? undefined : values[k] }));
  for (const alias of Object.keys(SEMANTIC_ALIASES)) out.push({ label: `--${alias}`, detail: "shortcut" });
  const seen = new Set<string>();
  return out.filter((s) => (seen.has(s.label) ? false : (seen.add(s.label), true)));
}

/** Plexo's ready-made parts, as tags to drop in (see the Embed Widget list). */
export const COMPONENT_SNIPPETS: Suggestion[] = [
  { label: "Shop grid", detail: "products people can buy", apply: '<div data-plexo-commerce-shopGrid data-plexo-commerce-items-per-row="3"></div>' },
  { label: "Sell one product", detail: "buy-now card", apply: '<div data-plexo-commerce-product data-plexo-product-id="${product id}" data-plexo-commerce-mode="buy"></div>' },
  { label: "Cart summary", detail: "items and total", apply: "<div data-plexo-commerce-cartSummary></div>" },
  { label: "Checkout form", detail: "delivery and payment", apply: "<div data-plexo-commerce-checkoutFlow></div>" },
  { label: "Order confirmation", apply: "<div data-plexo-commerce-orderConfirmation></div>" },
  { label: "Order tracking", apply: "<div data-plexo-commerce-orderTracking></div>" },
  { label: "Newsletter signup", detail: "email box", apply: "<div data-plexo-newsletter-signup></div>" },
  { label: "Contact form", detail: "goes to your inbox", apply: '<form data-plexo-form="${Contact}">\n  <input name="name" placeholder="Your name" required>\n  <input name="email" type="email" placeholder="Your email" required>\n  <textarea name="message" placeholder="Message"></textarea>\n  <button type="submit">Send</button>\n</form>' },
];

export const ATTRIBUTE_SUGGESTIONS: Suggestion[] = [
  "data-plexo-commerce-shopGrid",
  "data-plexo-commerce-product",
  "data-plexo-commerce-cartSummary",
  "data-plexo-commerce-checkoutFlow",
  "data-plexo-commerce-orderConfirmation",
  "data-plexo-commerce-orderTracking",
  "data-plexo-commerce-category",
  "data-plexo-commerce-limit",
  "data-plexo-commerce-items-per-row",
  "data-plexo-product-id",
  "data-plexo-newsletter-signup",
  "data-plexo-form",
].map((label) => ({ label, detail: "Plexo" }));

const CLASS_GROUPS = [
  "container mx-auto px-4 py-8 py-12 py-16 p-4 p-6 p-8 m-0 mt-4 mb-4 mb-8 gap-2 gap-4 gap-6 gap-8 space-y-4",
  "flex inline-flex grid block hidden flex-col flex-row flex-wrap items-center items-start justify-center justify-between justify-end grid-cols-1 grid-cols-2 grid-cols-3 grid-cols-4 col-span-2",
  "w-full h-full min-h-screen max-w-sm max-w-md max-w-lg max-w-xl max-w-2xl max-w-4xl max-w-6xl max-w-7xl",
  "text-xs text-sm text-base text-lg text-xl text-2xl text-3xl text-4xl text-5xl text-center text-left text-right font-normal font-medium font-semibold font-bold uppercase leading-tight leading-relaxed tracking-tight",
  "bg-white bg-black bg-transparent bg-gray-50 bg-gray-100 bg-gray-900 text-white text-black text-gray-500 text-gray-700 text-gray-900 border border-2 border-gray-200 border-transparent",
  "rounded rounded-md rounded-lg rounded-xl rounded-2xl rounded-full shadow shadow-md shadow-lg overflow-hidden relative absolute fixed sticky top-0 z-10 opacity-50 object-cover",
  "hover:bg-gray-100 hover:underline hover:opacity-80 transition duration-200 focus:outline-none cursor-pointer",
  "sm:flex md:flex md:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 lg:grid-cols-4 md:hidden hidden md:block",
  "btn btn-primary btn-secondary card hero section nav navbar footer header",
].join(" ").split(/\s+/);
export const COMMON_CLASSES: string[] = Array.from(new Set(CLASS_GROUPS));

/** Every class name the page already uses, so the same ones are one keystroke away. */
export function classesInPage(html: string, limit = 400): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(/\bclass\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    for (const c of (m[2] ?? m[3] ?? "").split(/\s+/)) if (c && c.length < 60 && !/[{}$<>]/.test(c)) found.add(c);
    if (found.size >= limit) break;
  }
  return [...found];
}

/** What kind of thing is being typed at the end of `before` (the text up to the cursor). */
export type Cursor =
  | { kind: "token"; from: number }
  | { kind: "class"; from: number }
  | { kind: "tag"; from: number }
  | { kind: "attr"; from: number }
  | null;

export function cursorContext(before: string): Cursor {
  const tok = /--[\w-]*$/.exec(before);
  if (tok) return { kind: "token", from: tok.index };
  const cls = /\bclass\s*=\s*(["'])[^"']*?([\w:\-/[\].%]*)$/i.exec(before);
  if (cls) return { kind: "class", from: before.length - cls[2].length };
  const tag = /<[\w-]*$/.exec(before);
  if (tag) return { kind: "tag", from: tag.index };
  const attr = /\sdata-plexo[\w-]*$/.exec(before);
  if (attr) return { kind: "attr", from: attr.index + 1 };
  return null;
}
