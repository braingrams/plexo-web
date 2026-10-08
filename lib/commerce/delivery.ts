import type { EntityItem } from "electrodb";
import { CommerceDeliveryMethod, CommerceSettings } from "@/lib/db/commerceEntities";

type DeliveryMethodItem = EntityItem<typeof CommerceDeliveryMethod>;
type SettingsItem = EntityItem<typeof CommerceSettings>;
type Address = { country?: string | null; state?: string | null };

/**
 * The built-in "Store pickup" option — not a CommerceDeliveryMethod row, so it exists for
 * every store out of the box (CommerceSettings.pickupEnabled, default true) even when the
 * owner never set up a single delivery method. Free, never address-scoped, and points at
 * CommerceSettings.pickupLocation (snapshotted onto the order at checkout).
 */
export const STORE_PICKUP_ID = "store-pickup";

/** What a site's delivery/pickup switches resolve to — absent fields keep their entity
 * defaults (delivery on, pickup on), since a row created before these existed has neither. */
export function resolveFulfillmentOptions(settings: Pick<SettingsItem, "deliveryEnabled" | "pickupEnabled" | "pickupLocation" | "pickupInstructions"> | null | undefined) {
  return {
    deliveryEnabled: settings?.deliveryEnabled ?? true,
    pickupEnabled: settings?.pickupEnabled ?? true,
    pickupLocation: settings?.pickupLocation?.trim() || null,
    pickupInstructions: settings?.pickupInstructions?.trim() || null,
  };
}

/** A synthetic method item for the built-in store pickup — shaped like a real row so the
 * order-creation code path (which snapshots name/type/fee) needs no special case. */
function storePickupMethod(templateId: string, organizationId: string): DeliveryMethodItem {
  return {
    id: STORE_PICKUP_ID,
    templateId,
    organizationId,
    name: "Store pickup",
    type: "PICKUP",
    feeMinor: 0,
    status: "ACTIVE",
    sortOrder: -1,
  } as DeliveryMethodItem;
}

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

/**
 * Every option a customer can actually pick for a given address — what the storefront's
 * checkout shows. Shipping (COURIER) methods are address-scoped and hidden entirely when
 * the owner turned delivery off. Pickup options (the built-in store pickup + any PICKUP
 * rows) are NOT address-scoped: where the customer lives doesn't change whether they can
 * come to the shop, and a pickup-only customer shouldn't have to type an address at all.
 */
export async function resolveAvailableDeliveryMethods(templateId: string, address: Address): Promise<DeliveryMethodItem[]> {
  const [{ data: methods }, { data: settings }] = await Promise.all([
    CommerceDeliveryMethod.query.primary({ templateId }).go({ pages: "all" }),
    CommerceSettings.get({ templateId }).go(),
  ]);
  const options = resolveFulfillmentOptions(settings);
  const available = methods
    .filter((m) => m.status !== "INACTIVE")
    .filter((m) => (m.type === "PICKUP" ? true : options.deliveryEnabled && isMethodApplicable(m, address)))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  if (options.pickupEnabled && settings) available.unshift(storePickupMethod(templateId, settings.organizationId));
  return available;
}

export class InvalidDeliveryMethodError extends Error {}

/**
 * Resolves and re-validates a customer-chosen delivery method server-side at checkout
 * time — never trust a client-supplied method id or fee, same rule as product prices.
 * Returns null when no method was chosen (a cart with no PHYSICAL items has nothing to
 * resolve). Throws InvalidDeliveryMethodError when the chosen method doesn't exist, is
 * inactive, has been switched off by the owner, or doesn't actually cover the given
 * address — e.g. a customer who picked a method, then changed their address to somewhere
 * it doesn't serve.
 */
export async function resolveOrderDeliveryMethod(
  templateId: string,
  deliveryMethodId: string | null | undefined,
  address: Address,
): Promise<DeliveryMethodItem | null> {
  if (!deliveryMethodId) return null;
  const { data: settings } = await CommerceSettings.get({ templateId }).go();
  const options = resolveFulfillmentOptions(settings);

  if (deliveryMethodId === STORE_PICKUP_ID) {
    if (!options.pickupEnabled || !settings) {
      throw new InvalidDeliveryMethodError("Store pickup isn't available for this store right now — please choose another option.");
    }
    return storePickupMethod(templateId, settings.organizationId);
  }

  const { data: method } = await CommerceDeliveryMethod.get({ templateId, id: deliveryMethodId }).go();
  if (!method || method.status === "INACTIVE") {
    throw new InvalidDeliveryMethodError("That delivery option isn't available any more — please choose another.");
  }
  if (method.type === "COURIER" && !options.deliveryEnabled) {
    throw new InvalidDeliveryMethodError("This store isn't offering delivery right now — please choose pickup instead.");
  }
  if (method.type === "COURIER" && !isMethodApplicable(method, address)) {
    throw new InvalidDeliveryMethodError("That delivery option isn't available for your location.");
  }
  return method;
}

/** The pickup address to snapshot onto an order, or undefined for a shipped order. A
 * custom PICKUP row's own description is its location; the built-in store pickup uses
 * the store's pickupLocation setting. */
export function pickupLocationFor(method: DeliveryMethodItem | null, settings: SettingsItem | null | undefined): string | undefined {
  if (!method || method.type !== "PICKUP") return undefined;
  if (method.id === STORE_PICKUP_ID) {
    const { pickupLocation, pickupInstructions } = resolveFulfillmentOptions(settings);
    return [pickupLocation, pickupInstructions].filter(Boolean).join(" — ") || undefined;
  }
  return method.description?.trim() || undefined;
}
