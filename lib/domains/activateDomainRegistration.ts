import { resolveRegistrarProvider, type DomainContact } from "./registrarProvider";
import { refundFailedDomainPurchase } from "./refundDomainPurchase";
import { RegisteredDomain } from "@/lib/db/contentEntities";
import type { EntityItem } from "electrodb";

/**
 * Shared by both funding paths once payment is confirmed: the Stripe webhook
 * (app/api/webhooks/stripe/route.ts, for `paymentMethod: "STRIPE"`) and the wallet-payment
 * branch of app/api/v1/domains/purchase/route.ts (`paymentMethod: "WALLET"`, which has no
 * webhook of its own since no external payment processor is involved). Kicks off
 * RegisterDomain (or, for the manual-fulfillment path, just flips to MANUAL_PENDING) and
 * auto-refunds on failure — a charged-but-domain-less row must never sit silently, see
 * lib/domains/refundDomainPurchase.ts's own comment.
 */
export async function activateDomainRegistration(registeredDomain: EntityItem<typeof RegisteredDomain>): Promise<void> {
  const { templateId, id: registeredDomainId } = registeredDomain;
  if (registeredDomain.status !== "PENDING_PAYMENT") return; // already handled (e.g. a retried Stripe webhook delivery)

  if (registeredDomain.registrarProvider === "MANUAL") {
    await RegisteredDomain.patch({ templateId, id: registeredDomainId })
      .set({ status: "MANUAL_PENDING", manualFulfillment: true })
      .go();
    return;
  }

  const { provider } = await resolveRegistrarProvider(registeredDomain.domain);
  const contact = JSON.parse(registeredDomain.registrantContactJson ?? "{}") as DomainContact;

  try {
    const { operationId } = await provider.register({ domain: registeredDomain.domain, years: 1, autoRenew: registeredDomain.autoRenew ?? true, contact });
    await RegisteredDomain.patch({ templateId, id: registeredDomainId })
      .set({ status: "REGISTERING", registrarOperationId: operationId })
      .go();
  } catch (err) {
    await RegisteredDomain.patch({ templateId, id: registeredDomainId })
      .set({ status: "REGISTRATION_FAILED", statusReason: err instanceof Error ? err.message : "RegisterDomain failed." })
      .go();
    await refundFailedDomainPurchase(registeredDomain);
  }
}
