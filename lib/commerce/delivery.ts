import type { EntityItem } from "electrodb";
import { CommerceDeliveryMethod } from "@/lib/db/commerceEntities";

type DeliveryMethodItem = EntityItem<typeof CommerceDeliveryMethod>;
type Address = { country?: string | null; state?: string | null };

/**
 * A method with an empty/absent `countries` list is unrestricted (worldwide); same rule
 * for `states` (any state within an allowed country). A non-empty list restricts the
 * method to exactly those values — countries as ISO-3166-1 alpha-2 codes, states as
 * free-text, both normalized uppercase at write time (see the delivery-methods API
 * routes), matched here case-insensitively against the same normalization.
 */
export function isMethodApplicable(method: DeliveryMethodItem, address: Address): boolean {
  if (method.status === "INACTIVE") return false;
  const country = address.country?.trim().toUpperCase();
  const state = address.state?.trim().toUpperCase();
  const countryOk = !method.countries?.length || (Boolean(country) && method.countries.includes(country!));
  const stateOk = !method.states?.length || (Boolean(state) && method.states.includes(state!));
  return countryOk && stateOk;
}

/** Every method configured for a site that's actually eligible for a given address —
 * what the storefront's checkout flow shows as delivery options. */
export async function resolveAvailableDeliveryMethods(templateId: string, address: Address): Promise<DeliveryMethodItem[]> {
  const { data: methods } = await CommerceDeliveryMethod.query.primary({ templateId }).go();
  return methods
    .filter((m) => isMethodApplicable(m, address))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

export class InvalidDeliveryMethodError extends Error {}

/**
 * Resolves and re-validates a customer-chosen delivery method server-side at checkout
 * time — never trust a client-supplied method id or fee, same rule as product prices.
 * Returns null when no method was chosen (a cart with no PHYSICAL items has nothing to
 * resolve). Throws InvalidDeliveryMethodError when the chosen method doesn't exist, is
 * inactive, or doesn't actually cover the given address — e.g. a customer who picked a
 * method, then changed their address to somewhere it doesn't serve.
 */
export async function resolveOrderDeliveryMethod(
  templateId: string,
  deliveryMethodId: string | null | undefined,
  address: Address,
): Promise<DeliveryMethodItem | null> {
  if (!deliveryMethodId) return null;
  const { data: method } = await CommerceDeliveryMethod.get({ templateId, id: deliveryMethodId }).go();
  if (!method || !isMethodApplicable(method, address)) {
    throw new InvalidDeliveryMethodError("That delivery option isn't available for your location.");
  }
  return method;
}
