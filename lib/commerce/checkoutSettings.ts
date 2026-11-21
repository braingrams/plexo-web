import type { EntityItem } from "electrodb";
import type { CommerceSettings } from "@/lib/db/commerceEntities";
import { normalizeCheckoutFields, readCheckoutFields, CheckoutFieldsError } from "@/lib/commerce/checkoutFields";
import { resolveFulfillmentOptions } from "@/lib/commerce/delivery";

type SettingsItem = EntityItem<typeof CommerceSettings>;

/**
 * The bank-transfer, checkout-question and delivery/pickup settings — validated in ONE
 * place so the dashboard's settings PUT and the update_commerce_settings MCP tool can
 * never drift apart on what's allowed. Throws CheckoutSettingsError with a message a
 * site owner (or an AI acting for one) can act on directly.
 */
export class CheckoutSettingsError extends Error {}

const TEXT_FIELDS = [
  "bankTransferBankName",
  "bankTransferAccountName",
  "bankTransferAccountNumber",
  "bankTransferInstructions",
  "pickupLocation",
  "pickupInstructions",
  "termsText",
  "termsUrl",
  "orderSuccessMessage",
  "orderEmailSubject",
  "orderEmailHeading",
  "orderEmailMessage",
] as const;
type TextField = (typeof TEXT_FIELDS)[number];
const MAX_TEXT: Record<TextField, number> = {
  bankTransferBankName: 100,
  bankTransferAccountName: 120,
  bankTransferAccountNumber: 40,
  bankTransferInstructions: 500,
  pickupLocation: 300,
  pickupInstructions: 500,
  termsText: 10000,
  termsUrl: 500,
  orderSuccessMessage: 1000,
  orderEmailSubject: 200,
  orderEmailHeading: 200,
  orderEmailMessage: 2000,
};

export function applyCheckoutSettingsInput(
  input: Record<string, unknown>,
  existing: SettingsItem | null | undefined,
): { data: Record<string, unknown>; toRemove: TextField[] } {
  const data: Record<string, unknown> = {};
  const toRemove: TextField[] = [];

  for (const key of TEXT_FIELDS) {
    const value = input[key];
    if (value === undefined) continue;
    if (value !== null && typeof value !== "string") throw new CheckoutSettingsError(`${key} must be text.`);
    const trimmed = (value ?? "").trim();
    if (trimmed.length > MAX_TEXT[key]) throw new CheckoutSettingsError(`${key} is too long (max ${MAX_TEXT[key]} characters).`);
    if (key === "termsUrl" && trimmed && !/^https?:\/\/[^\s/$.?#][^\s]*$/i.test(trimmed)) throw new CheckoutSettingsError("The link to your terms should start with https://, like https://yoursite.com/terms.");
    if (trimmed) data[key] = trimmed;
    else toRemove.push(key);
  }

  for (const key of ["bankTransferEnabled", "deliveryEnabled", "pickupEnabled"] as const) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== "boolean") throw new CheckoutSettingsError(`${key} must be true or false.`);
    data[key] = input[key];
  }

  if (input.checkoutFields !== undefined) {
    try {
      data.checkoutFields = normalizeCheckoutFields(input.checkoutFields);
    } catch (err) {
      if (err instanceof CheckoutFieldsError) throw new CheckoutSettingsError(err.message);
      throw err;
    }
  }

  // Cross-field rules, judged on the values this save would leave in place.
  const effective = (key: TextField) => (key in data ? (data[key] as string) : toRemove.includes(key) ? "" : (existing?.[key] ?? "").trim());
  const bankOn = (data.bankTransferEnabled as boolean | undefined) ?? existing?.bankTransferEnabled ?? false;
  if (bankOn) {
    const missing = [
      !effective("bankTransferBankName") && "bank name",
      !effective("bankTransferAccountName") && "account name",
      !effective("bankTransferAccountNumber") && "account number",
    ].filter(Boolean);
    if (missing.length) {
      throw new CheckoutSettingsError(`To accept bank transfers, add your ${missing.join(", ")} — customers need these to pay you.`);
    }
  }
  const deliveryOn = (data.deliveryEnabled as boolean | undefined) ?? existing?.deliveryEnabled ?? true;
  const pickupOn = (data.pickupEnabled as boolean | undefined) ?? existing?.pickupEnabled ?? true;
  if (!deliveryOn && !pickupOn) {
    throw new CheckoutSettingsError("Keep delivery or store pickup switched on — otherwise customers have no way to receive physical products.");
  }

  return { data, toRemove };
}

/** The same fields, shaped for a GET/PUT response (dashboard + MCP). */
export function checkoutSettingsView(settings: SettingsItem | null | undefined) {
  const fulfillment = resolveFulfillmentOptions(settings);
  return {
    bankTransferEnabled: settings?.bankTransferEnabled ?? false,
    bankTransferBankName: settings?.bankTransferBankName ?? null,
    bankTransferAccountName: settings?.bankTransferAccountName ?? null,
    bankTransferAccountNumber: settings?.bankTransferAccountNumber ?? null,
    bankTransferInstructions: settings?.bankTransferInstructions ?? null,
    checkoutFields: readCheckoutFields(settings?.checkoutFields),
    deliveryEnabled: fulfillment.deliveryEnabled,
    pickupEnabled: fulfillment.pickupEnabled,
    pickupLocation: fulfillment.pickupLocation,
    pickupInstructions: fulfillment.pickupInstructions,
    termsText: settings?.termsText ?? null,
    termsUrl: settings?.termsUrl ?? null,
    orderSuccessMessage: settings?.orderSuccessMessage ?? null,
    orderEmailSubject: settings?.orderEmailSubject ?? null,
    orderEmailHeading: settings?.orderEmailHeading ?? null,
    orderEmailMessage: settings?.orderEmailMessage ?? null,
  };
}
