/**
 * One Charisol Paystack account serves more than one Charisol product (Plexo, Maildrip, ...). Paystack has a single webhook per
 * account, so every charge made through that account carries `metadata.product`, and whatever receives the webhook (Charisol's
 * router, or each product's own endpoint) can tell whose charge it is. Plexo's is "plexo".
 *
 * Only charges made with Charisol's own (platform) key are tagged. A Commerce site that brings its OWN Paystack account is the
 * site owner's account, not Charisol's, so nothing is added there.
 */
export const PAYSTACK_PRODUCT = "plexo";

/** The metadata for a charge: ours plus `product`, never overriding a product the caller set on purpose. */
export function withProduct(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  return { product: PAYSTACK_PRODUCT, ...(metadata ?? {}) };
}

/** Which product a Paystack event/transaction belongs to, when it says. Undefined for charges made before tagging, and for plan renewals (Paystack makes those itself, with no metadata of ours). */
export function productOf(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const p = (metadata as Record<string, unknown>).product;
  return typeof p === "string" && p.trim() ? p.trim().toLowerCase() : undefined;
}

/** True only when the event clearly belongs to another Charisol product. Untagged events are treated as Plexo's, so nothing already in flight is dropped. */
export const isOtherProduct = (metadata: unknown): boolean => {
  const p = productOf(metadata);
  return p !== undefined && p !== PAYSTACK_PRODUCT;
};
