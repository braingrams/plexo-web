// What a workspace's plan allows in Commerce (lib/subscription.ts):
//   Free        — no store.
//   Starter     — a store with up to 1,000 products, paid through Plexo's own payment account
//                 (PLATFORM_PAYSTACK / PLATFORM_STRIPE) only.
//   Pro         — 5,000 products, and the store may use its own Paystack/Stripe keys.
//   Enterprise  — 10,000 products.
// During the free trial the store can be built but takes no real payments until the plan is paid.
//
// Pure rules + a loader that only needs the workspace id (no next/headers — the SOL Lambda's
// MCP tools use this too). Every message is written for the site owner.

import { CommerceProduct } from "@/lib/db/commerceEntities";
import { getTierFeatures } from "@/lib/subscription";
import { planFromOwner, workspaceOwner } from "./workspacePlan";

export type CommercePlan = { plan: string; onTrial: boolean };

export const BYO_PROVIDERS = new Set(["BYO_PAYSTACK", "BYO_STRIPE"]);

export async function commercePlanForOrg(organizationId: string): Promise<CommercePlan> {
  const { subscriptionPlan, onTrial } = planFromOwner(await workspaceOwner(organizationId));
  return { plan: subscriptionPlan, onTrial };
}

/** Switching the store on. */
export function commerceEnableError(p: CommercePlan): string | null {
  return getTierFeatures(p.plan).commerceEnabled ? null : "Selling online comes with the Starter plan and above. Upgrade in Settings → Billing to open your store.";
}

/** Choosing how the store gets paid. */
export function paymentProviderError(p: CommercePlan, provider: string | null | undefined): string | null {
  if (!provider || !BYO_PROVIDERS.has(provider)) return null;
  return getTierFeatures(p.plan).ownPaymentKeysEnabled
    ? null
    : "Using your own Paystack or Stripe account is part of the Pro plan. On your plan, payments go through Plexo's payment account (choose “Plexo handles payments”), and you withdraw from your wallet.";
}

/** The provider a store should start on: its own keys need Pro, so smaller plans start on Plexo's. */
export function defaultPaymentProvider(p: CommercePlan): "BYO_PAYSTACK" | "PLATFORM_PAYSTACK" {
  return getTierFeatures(p.plan).ownPaymentKeysEnabled ? "BYO_PAYSTACK" : "PLATFORM_PAYSTACK";
}

/** Adding `adding` more products to a store that has `existing`. */
export function productLimitError(p: CommercePlan, existing: number, adding = 1): string | null {
  const features = getTierFeatures(p.plan);
  if (!features.commerceEnabled) return commerceEnableError(p);
  if (existing + adding <= features.maxCommerceProducts) return null;
  const left = Math.max(0, features.maxCommerceProducts - existing);
  return `Your plan holds up to ${features.maxCommerceProducts.toLocaleString("en-US")} products${left ? ` — there's room for ${left.toLocaleString("en-US")} more` : " and the store is full"}. Upgrade for more, or remove products you no longer sell.`;
}

/** Taking a real payment at checkout (what the VISITOR sees, so it's about the store, not the plan). */
export function livePaymentError(p: CommercePlan, provider: string | null | undefined): string | null {
  const features = getTierFeatures(p.plan, { trial: p.onTrial });
  if (!features.commerceEnabled || !features.livePaymentsEnabled) return "This store isn't taking payments yet. Please check back soon.";
  if (provider && BYO_PROVIDERS.has(provider) && !features.ownPaymentKeysEnabled) return "This store isn't taking payments right now. Please check back soon.";
  return null;
}

export async function countStoreProducts(templateId: string): Promise<number> {
  const { data } = await CommerceProduct.query.primary({ templateId }).go({ pages: "all", attributes: ["id"] });
  return data.length;
}

/** Whether a store's current payment setup takes real money (Plexo's own account, or its own keys in live mode). */
export function takesLivePayments(settings: { paymentProvider?: string | null; paystackMode?: string | null; stripeMode?: string | null }): boolean {
  const provider = settings.paymentProvider ?? "BYO_PAYSTACK";
  if (provider === "PLATFORM_PAYSTACK" || provider === "PLATFORM_STRIPE") return true;
  if (provider === "BYO_STRIPE") return settings.stripeMode === "LIVE";
  return settings.paystackMode === "LIVE";
}

/**
 * The visitor-facing check at checkout: null when the store may take this payment, else a
 * calm message. Test-mode payments with the store's own keys are always allowed (that's how
 * an owner tries their store, including during the trial) — as long as the plan has a store.
 */
export async function checkoutPlanBlock(settings: { organizationId: string; paymentProvider?: string | null; paystackMode?: string | null; stripeMode?: string | null }): Promise<string | null> {
  const p = await commercePlanForOrg(settings.organizationId);
  if (!getTierFeatures(p.plan).commerceEnabled) return "This store isn't taking orders right now. Please check back soon.";
  if (!takesLivePayments(settings)) return null;
  return livePaymentError(p, settings.paymentProvider);
}
