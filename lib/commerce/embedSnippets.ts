/**
 * The markup that puts one product on a page. Pure strings (no server imports) so the
 * dashboard's copy-paste modal, the one-click "Sell this product" action and the AI tools all
 * produce exactly the same thing — public/commerce.js paints whatever finds this marker.
 */
const attr = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export type ProductSnippetOptions = {
  /** Text on the button. Default "Buy now". */
  buttonLabel?: string;
};

/** The one-line marker: a buy-now card for a single product, with checkout right on the page. */
export function productMarker(productId: string, opts: ProductSnippetOptions = {}): string {
  const label = opts.buttonLabel?.trim() && opts.buttonLabel.trim() !== "Buy now" ? ` data-plexo-commerce-button-label="${attr(opts.buttonLabel.trim())}"` : "";
  return `<div data-plexo-commerce-product data-plexo-product-id="${attr(productId)}" data-plexo-commerce-mode="buy"${label}></div>`;
}

/** The marker in a centred section, for dropping into a hand-written HTML page. */
export function productSection(productId: string, opts: ProductSnippetOptions = {}): string {
  return `<section id="plexo-buy" style="padding:64px 20px;display:flex;justify-content:center;">\n  <div style="width:100%;max-width:520px;">\n    ${productMarker(productId, opts)}\n  </div>\n</section>`;
}

/** The same marker as JSX, for a React app (the page's own code owns the rest of the layout). */
export function productJsx(productId: string, opts: ProductSnippetOptions = {}): string {
  const label = opts.buttonLabel?.trim() && opts.buttonLabel.trim() !== "Buy now" ? ` data-plexo-commerce-button-label=${JSON.stringify(opts.buttonLabel.trim())}` : "";
  return `<div data-plexo-commerce-product data-plexo-product-id=${JSON.stringify(productId)} data-plexo-commerce-mode="buy"${label} />`;
}

/** True when the HTML already sells this product with a buy card (so a second click adds nothing). */
export function hasProductMarker(html: string, productId: string): boolean {
  const id = attr(productId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`data-plexo-product-id=["']${id}["']`).test(html);
}

/**
 * Places `fragment` in a hand-written page: just above the first <footer>, so the offer sits
 * with the page's content rather than after its footer; else before </body>; else at the end.
 * <script>/<style> bodies are masked first so a "<footer" inside one is never mistaken for the tag.
 */
export function insertBeforeFooter(html: string, fragment: string): string {
  const masked = html.replace(/<(script|style)\b(?:"[^"]*"|'[^']*'|[^'">])*>[\s\S]*?<\/\1\s*>/gi, (block) => " ".repeat(block.length));
  const footer = masked.search(/<footer\b/i);
  let at = footer;
  if (at === -1) {
    const closes = Array.from(masked.matchAll(/<\/body\s*>/gi));
    at = closes.length ? closes[closes.length - 1].index! : -1;
  }
  if (at === -1) return `${html}\n${fragment}\n`;
  return `${html.slice(0, at)}${fragment}\n${html.slice(at)}`;
}
