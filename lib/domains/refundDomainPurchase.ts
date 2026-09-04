import { getStripe } from "@/lib/stripe";
import { resolveCommerceWallet, creditCommerceWalletForDomainRefund } from "@/lib/commerce/walletDynamo";
import type { EntityItem } from "electrodb";
import type { RegisteredDomain as RegisteredDomainEntity } from "@/lib/db/contentEntities";

/**
 * Shared by the purchase webhook (app/api/webhooks/stripe), the wallet-payment branch of
 * app/api/v1/domains/purchase/route.ts, and the registration poller
 * (app/api/internal/domain-registration-poller) — all are places a paid-for domain can turn
 * out to be unregisterable after the fact (a race lost to another registrant, a transient
 * Route53 error that never recovers). A charged-but-domain-less RegisteredDomain row must
 * never sit silently.
 */
export async function refundFailedDomainPurchase(registeredDomain: EntityItem<typeof RegisteredDomainEntity>): Promise<void> {
  const amountCents = registeredDomain.purchasePriceUsdCents;
  if (!amountCents) return;

  if (registeredDomain.paymentMethod === "WALLET") {
    try {
      const wallet = await resolveCommerceWallet(registeredDomain.templateId, registeredDomain.organizationId);
      await creditCommerceWalletForDomainRefund(wallet, amountCents, registeredDomain.id, `Refund — registration failed for ${registeredDomain.domain}`);
    } catch (err) {
      console.error(`Failed to auto-refund (wallet) failed domain registration for ${registeredDomain.domain}:`, err);
    }
    return;
  }

  if (registeredDomain.paymentMethod !== "STRIPE" || !registeredDomain.paymentReference) return;
  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(registeredDomain.paymentReference);
    if (typeof session.payment_intent === "string") {
      await stripe.refunds.create({ payment_intent: session.payment_intent });
    }
  } catch (err) {
    console.error(`Failed to auto-refund failed domain registration for ${registeredDomain.domain}:`, err);
  }
}
