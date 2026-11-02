/**
 * Where a buyer lands after paying. A site with a full storefront sends them to its
 * /order-confirmation page; a one-page site (Free serves only the homepage, a React app or
 * raw upload may have no such page at all) sends them back to the page they bought from,
 * where public/commerce.js shows the thank-you in place — see `plexo_order` there.
 *
 * `returnPath` comes from the visitor's browser, so it is only ever honoured as a path on
 * THIS site: never an absolute or protocol-relative URL, which would turn a payment return
 * into an open redirect.
 */
export const ORDER_RETURN_PARAM = "plexo_order";

export function safeReturnPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const path = raw.trim();
  if (!path || path.length > 300) return null;
  // One leading slash only: "//evil.com" and "/\evil.com" are both treated as a host by browsers.
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return null;
  if (/[\u0000-\u001f]/.test(path)) return null;
  // Whatever query/hash the page had is dropped — the order params are the only ones we add.
  return path.split(/[?#]/)[0] || "/";
}

/** The payment return address for an order: the buyer's own page when one was given, else the confirmation page. */
export function orderReturnUrl(origin: string, orderNumber: string, email: string, returnPath: string | null): string {
  const email_ = encodeURIComponent(email);
  if (returnPath) return `${origin}${returnPath}?${ORDER_RETURN_PARAM}=${encodeURIComponent(orderNumber)}&email=${email_}`;
  return `${origin}/order-confirmation?order=${orderNumber}&email=${email_}`;
}

/**
 * A site that can't serve /order-confirmation (Free serves the homepage only; an app has no such
 * page) still has to show the buyer their order when a link to it is followed — a bank-transfer
 * email, a bookmark, an old payment return. Maps that link onto the homepage, where
 * public/commerce.js shows the same details in place. Null for any other address.
 */
export function orderLinkOnHomepage(pathname: string, search: string): string | null {
  if (pathname.replace(/\/+$/, "") !== "/order-confirmation") return null;
  const params = new URLSearchParams(search);
  const order = params.get("order");
  const email = params.get("email");
  if (!order || !email) return null;
  return `/?${ORDER_RETURN_PARAM}=${encodeURIComponent(order)}&email=${encodeURIComponent(email)}`;
}
