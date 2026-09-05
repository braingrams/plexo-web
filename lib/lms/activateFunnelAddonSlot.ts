import type Stripe from "stripe";
import { LmsFunnelAddonSlot } from "@/lib/db/contentEntities";
import { reconcileFunnelSlotsForOrg } from "./funnelSlots";

/**
 * Called from app/api/webhooks/stripe/route.ts's customer.subscription.created/updated
 * cases when the subscription's metadata identifies it as an lms_addon_slot (as opposed to
 * the platform PRO/ULTRA plan subscription those cases otherwise handle). One Subscription
 * object per slot (see LmsFunnelAddonSlot's own comment) means this only ever touches the
 * one slot named in metadata — every other slot/funnel on the org is untouched.
 */
export async function handleLmsAddonSlotSubscriptionUpdate(subscription: Stripe.Subscription): Promise<void> {
  const slotId = subscription.metadata?.slotId;
  const organizationId = subscription.metadata?.organizationId;
  if (!slotId || !organizationId) return;

  const { data: slot } = await LmsFunnelAddonSlot.get({ organizationId, id: slotId }).go();
  if (!slot) return;

  if (subscription.status === "active" || subscription.status === "trialing") {
    await LmsFunnelAddonSlot.patch({ organizationId, id: slotId })
      .set({
        status: "ACTIVE",
        stripeSubscriptionId: subscription.id,
        activatedAt: slot.activatedAt ?? new Date().toISOString(),
      })
      .go();
    return;
  }

  if (subscription.status === "past_due" || subscription.status === "unpaid") {
    // Grace period — still counted as funded by countFundedAddonSlots, so no reconciliation
    // needed yet, same "retry, warn, then act" discipline as domain renewal billing.
    await LmsFunnelAddonSlot.patch({ organizationId, id: slotId }).set({ status: "PAST_DUE", pastDueAt: new Date().toISOString() }).go();
    return;
  }

  if (subscription.status === "canceled" || subscription.status === "incomplete_expired") {
    await LmsFunnelAddonSlot.patch({ organizationId, id: slotId })
      .set({ status: "CANCELLED", cancelledAt: new Date().toISOString(), lastPaymentFailureReason: "Subscription ended." })
      .go();
    await reconcileFunnelSlotsForOrg(organizationId);
  }
}

/** customer.subscription.deleted for an lms_addon_slot subscription — the slot's grace
 * period is over (or it was cancelled outright); reconcile immediately. */
export async function handleLmsAddonSlotSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const slotId = subscription.metadata?.slotId;
  const organizationId = subscription.metadata?.organizationId;
  if (!slotId || !organizationId) return;

  await LmsFunnelAddonSlot.patch({ organizationId, id: slotId })
    .set({ status: "CANCELLED", cancelledAt: new Date().toISOString() })
    .go();
  await reconcileFunnelSlotsForOrg(organizationId);
}
