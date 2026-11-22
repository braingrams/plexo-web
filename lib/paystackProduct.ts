/**
 * One Charisol Paystack account serves more than one Charisol product (Plexo, Maildrip, ...). Paystack has a single webhook per
 * account, so every charge made through that account carries `metadata.product`, and whatever receives the webhook (Charisol's
 * router, or each product's own endpoint) can tell whose charge it is. Plexo's is "plexo".
 *
 * To make the product tag visible on the Paystack Dashboard (under transaction / customer details) and in transaction CSV/Excel
 * exports, Paystack requires the field to be in `metadata.custom_fields` as well as the top-level property.
 *
 * Only charges made with Charisol's own (platform) key are tagged. A Commerce site that brings its OWN Paystack account is the
 * site owner's account, not Charisol's, so nothing is added there.
 */
export const PAYSTACK_PRODUCT = "plexo";

export type PaystackCustomField = {
  display_name: string;
  variable_name: string;
  value: string;
};

function formatProductValue(product: string): string {
  if (product.toLowerCase() === "plexo") return "Plexo";
  if (product.toLowerCase() === "maildrip") return "Maildrip";
  return product.charAt(0).toUpperCase() + product.slice(1);
}

/** The metadata for a charge: ours plus `product` (and dashboard custom_fields), never overriding a product the caller set on purpose. */
export function withProduct(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  const product = typeof metadata?.product === "string" && metadata.product.trim() ? metadata.product.trim() : PAYSTACK_PRODUCT;
  const existingFields = Array.isArray(metadata?.custom_fields)
    ? (metadata.custom_fields as Record<string, unknown>[])
    : [];

  const hasProductField = existingFields.some(
    (f) => f && typeof f === "object" && (f as Record<string, unknown>).variable_name === "product",
  );

  const custom_fields: Record<string, unknown>[] = hasProductField
    ? existingFields
    : [
        ...existingFields,
        {
          display_name: "Product",
          variable_name: "product",
          value: formatProductValue(product),
        },
      ];

  return {
    product,
    ...(metadata ?? {}),
    custom_fields,
  };
}

/** Which product a Paystack event/transaction belongs to, when it says. Undefined for charges made before tagging, and for plan renewals (Paystack makes those itself, with no metadata of ours). */
export function productOf(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const p = (metadata as Record<string, unknown>).product;
  if (typeof p === "string" && p.trim()) return p.trim().toLowerCase();
  const rawFields = (metadata as Record<string, unknown>).custom_fields;
  if (Array.isArray(rawFields)) {
    const field = rawFields.find(
      (f) => f && typeof f === "object" && (f as Record<string, unknown>).variable_name === "product",
    ) as Record<string, unknown> | undefined;
    const val = field?.value;
    if (typeof val === "string" && val.trim()) return val.trim().toLowerCase();
  }
  return undefined;
}

/** True only when the event clearly belongs to another Charisol product. Untagged events are treated as Plexo's, so nothing already in flight is dropped. */
export const isOtherProduct = (metadata: unknown): boolean => {
  const p = productOf(metadata);
  return p !== undefined && p !== PAYSTACK_PRODUCT;
};
