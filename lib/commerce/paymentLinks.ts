/**
 * Finding — and swapping — the hosted "pay me" links a page already has, so selling through
 * Commerce replaces them instead of sitting beside them. Only checkout-style links are
 * recognised (a product's own pay page): never donation or tip links, social links, or
 * anything else that merely mentions a payment company.
 *
 * What replaces a link is `href="#plexo-buy-<productId>"`: public/commerce.js turns a click on
 * it into the Buy now checkout on the same page. A plain string, so it can be set in any
 * editor — raw HTML, the visual editor's link field, a classic button, or a React app.
 */
const PAYMENT_LINKS: RegExp[] = [
  /^https?:\/\/(www\.)?flutterwave\.com\/(pay|store)\//i,
  /^https?:\/\/(www\.)?paystack\.(com\/(pay|buy)|shop)\//i,
  /^https?:\/\/(www\.)?selar\.(co|com)\//i,
  /^https?:\/\/(buy|checkout)\.stripe\.com\//i,
  /^https?:\/\/([a-z0-9-]+\.)?gumroad\.com\/l\//i,
  /^https?:\/\/(www\.)?payhip\.com\/b\//i,
  /^https?:\/\/[a-z0-9-]+\.lemonsqueezy\.com\/(checkout|buy)\//i,
  /^https?:\/\/(www\.)?sellfy\.com\/p\//i,
];

export const isPaymentLink = (url: unknown): url is string => typeof url === "string" && PAYMENT_LINKS.some((re) => re.test(url.trim()));

/** The link that opens the Buy now checkout for a product. */
export const buyHref = (productId: string): string => `#plexo-buy-${encodeURIComponent(productId)}`;

/**
 * Which of the page's payment links belong to this product. One distinct link is clearly the
 * product's own; several different ones are probably different offers, so none is touched
 * unless the caller says which (`hint`, part of the URL) — better to ask than to point
 * someone's other product at the wrong price.
 */
export function pickLinksToConvert(urls: string[], hint?: string): { urls: string[]; unclear: string[] } {
  const distinct = [...new Set(urls.map((u) => u.trim()))];
  const wanted = hint?.trim();
  if (wanted) return { urls: distinct.filter((u) => u.toLowerCase().includes(wanted.toLowerCase())), unclear: [] };
  if (distinct.length <= 1) return { urls: distinct, unclear: [] };
  return { urls: [], unclear: distinct };
}

const SKIP_BLOCKS = /(<(script|style)\b(?:"[^"]*"|'[^']*'|[^'">])*>[\s\S]*?<\/\2\s*>)/gi;
const ANCHOR = /<a\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi;
const HREF = /(\shref\s*=\s*)("([^"]*)"|'([^']*)')/i;

/** Every distinct payment link in `<a href>` tags (script and style bodies are ignored). */
export function findPaymentLinksInHtml(html: string): string[] {
  const urls: string[] = [];
  for (const [i, part] of html.split(SKIP_BLOCKS).entries()) {
    if (i % 3 !== 0) continue; // a captured script/style block (or its tag name), not page markup
    for (const tag of part.match(ANCHOR) ?? []) {
      const m = HREF.exec(tag);
      const url = m?.[3] ?? m?.[4];
      if (isPaymentLink(url)) urls.push(url.trim());
    }
  }
  return urls;
}

/** Points the chosen payment links at the product's Buy now; returns the new HTML and how many links changed. */
export function rewritePaymentLinksInHtml(html: string, productId: string, urls: string[]): { html: string; count: number } {
  const chosen = new Set(urls);
  let count = 0;
  const parts = html.split(SKIP_BLOCKS);
  // split() with a capture group interleaves the separators; code blocks (script/style) sit at the odd/captured slots.
  const out = parts.map((part, i) => {
    if (i % 3 === 2) return ""; // the capture of the tag NAME, not page content: split() adds it, putting it back would duplicate it
    if (i % 3 === 1) return part; // a whole script/style block — left exactly as it was
    return part.replace(ANCHOR, (tag) => {
      const m = HREF.exec(tag);
      const url = (m?.[3] ?? m?.[4])?.trim();
      if (!m || !url || !chosen.has(url)) return tag;
      count++;
      // No new tab for a link that now opens a checkout right here.
      return tag
        .replace(HREF, `$1"${buyHref(productId)}"`)
        .replace(/\starget\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, "")
        .replace(/\srel\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, "");
    });
  });
  return { html: out.join(""), count };
}

type Walkable = { id?: string; props?: { href?: unknown; block?: { content?: unknown } }; children?: Walkable[] };

/** A link on a visual (v2) page, and where to change it: a hand-built element, or a field of a ready-made section. */
export type VisualPaymentLink = { url: string } & ({ nodeId: string } | { sectionId: string; path: string; content: Record<string, unknown> });

/**
 * Every payment link on a visual (v2) page. A hand-designed element is changed by its id; a
 * ready-made section ("Hero", "Pricing"…) keeps its buttons as fields of its content (e.g.
 * `cta.href`, `plans.0.cta.href`) and is changed through the section, so those are reported
 * by section and field path instead.
 */
export function paymentLinkNodes(root: Walkable | undefined): VisualPaymentLink[] {
  const found: VisualPaymentLink[] = [];
  const walkContent = (sectionId: string, content: Record<string, unknown>, value: unknown, path: string[]) => {
    if (Array.isArray(value)) value.forEach((v, i) => walkContent(sectionId, content, v, [...path, String(i)]));
    else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        if (k === "href" && isPaymentLink(v)) found.push({ sectionId, content, path: [...path, k].join("."), url: (v as string).trim() });
        else walkContent(sectionId, content, v, [...path, k]);
      }
    }
  };
  const walk = (node: Walkable | undefined) => {
    if (!node) return;
    if (node.id && node.props?.block) {
      const content = node.props.block.content;
      if (content && typeof content === "object") walkContent(node.id, content as Record<string, unknown>, content, []); // a ready-made section: its content fields hold the links
      return;
    }
    if (node.id && isPaymentLink(node.props?.href)) found.push({ nodeId: node.id, url: (node.props!.href as string).trim() });
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  return found;
}

/** Every payment link in a classic (v1) design — the `href` of buttons and links. Returns edited copy via `rewrite`. */
export function classicPaymentLinks(design: unknown): string[] {
  const urls: string[] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        if (k === "href" && isPaymentLink(v)) urls.push((v as string).trim());
        else walk(v);
      }
    }
  };
  walk(design);
  return urls;
}

export function rewriteClassicPaymentLinks<T>(design: T, productId: string, urls: string[]): { design: T; count: number } {
  const chosen = new Set(urls);
  let count = 0;
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => {
          if (k === "href" && typeof v === "string" && chosen.has(v.trim())) {
            count++;
            return [k, buyHref(productId)];
          }
          return [k, walk(v)];
        }),
      );
    }
    return value;
  };
  return { design: walk(design) as T, count };
}

/**
 * The `updateSection` content that points a ready-made section's payment links at the checkout.
 * A section's fields are replaced whole (a button is `{label, href}`, a list is the whole list),
 * so each affected top-level field is sent complete, with only the link changed inside it.
 */
export function sectionLinkPatch(links: { path: string; content: Record<string, unknown> }[], href: string): Record<string, unknown> {
  const copy = structuredClone(links[0].content) as Record<string, unknown>;
  const touched = new Set<string>();
  for (const { path } of links) {
    const keys = path.split(".");
    let cursor: unknown = copy;
    for (const key of keys.slice(0, -1)) cursor = (cursor as Record<string, unknown>)[key];
    (cursor as Record<string, unknown>)[keys[keys.length - 1]] = href;
    touched.add(keys[0]);
  }
  return Object.fromEntries([...touched].map((k) => [k, copy[k]]));
}
