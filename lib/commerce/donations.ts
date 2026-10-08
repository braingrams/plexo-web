import { randomBytes, randomUUID } from "node:crypto";
import type { EntityItem } from "electrodb";
import { decryptPaystackKey, decryptStripeKey } from "@/lib/crypto";
import {
  createPaystackMonthlyPlan,
  disablePaystackSubscription,
  initializePaystackTransaction,
  listPaystackSubscriptions,
} from "@/lib/paystack";
import { resolveCheckoutPaystackSecret } from "@/lib/commerce/paystack";
import { resolveCheckoutStripeSecret } from "@/lib/commerce/stripe";
import {
  cancelStripeSubscription,
  createCommerceStripeCheckoutSession,
  createCommerceStripeDonationSubscriptionSession,
  listActiveStripeSubscriptions,
} from "@/lib/commerce/stripeClient";
import { generateBankTransferToken, isBankTransferReady, notifyBankTransferPlaced } from "@/lib/commerce/bankTransfer";
import { formatMoney } from "@/lib/commerce/formatMoney";
import { ensureOrderConfirmationPage } from "@/lib/commerce/storefrontLayout";
import { resolveSitePublicUrl } from "@/lib/commerce/siteUrlDynamo";
import { resolveMaildripApiKey, sendCommerceEmail } from "@/lib/mail/maildrip";
import { buildDonationReceiptEmail } from "@/lib/mail/templates";
import { getOrgBrandDynamo } from "@/server/orgDynamo";
import { Template } from "@/lib/db/contentEntities";
import {
  CommerceDonationCampaign,
  CommerceDonationSubscription,
  CommerceOrder,
  CommerceOrderItem,
  CommerceSettings,
} from "@/lib/db/commerceEntities";

// Plexo Donations — one-time and monthly giving, built on Commerce. A gift is a
// CommerceOrder (metadata.kind = "DONATION"), so it shows up in Orders and Customers,
// credits the Wallet on Plexo-managed payments, and can be refunded like any order. What
// lives here is only what's donation-specific: amount rules, monthly subscriptions on
// Stripe/Paystack, the donor's thank-you receipt and their self-service cancel link.

export type CampaignItem = EntityItem<typeof CommerceDonationCampaign>;
export type DonationSubscriptionItem = EntityItem<typeof CommerceDonationSubscription>;
type OrderItem = EntityItem<typeof CommerceOrder>;
type SettingsItem = EntityItem<typeof CommerceSettings>;

export interface DonationPreset {
  label?: string;
  amountMinor: number;
}

export class DonationError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "DonationError";
    this.status = status;
  }
}

export function isDonationOrder(order: { metadata?: unknown }): boolean {
  return (order.metadata as { kind?: string } | undefined)?.kind === "DONATION";
}

const MAX_PRESETS = 8;
const MAX_DONATION_MINOR = 100_000_000; // 1,000,000.00 in any 2-decimal currency — a fat-finger guard, not a policy

/** Validates owner-supplied campaign fields (dashboard, MCP, migration) into what's stored. */
export function normalizeCampaignInput(body: Record<string, unknown>, partial = false): { values: Partial<CampaignItem> } | { error: string } {
  const values: Partial<CampaignItem> = {};
  if (body.name !== undefined || !partial) {
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    if (!name) return { error: "Give the campaign a name, like \"Support our mission\"." };
    values.name = name;
  }
  if (body.description !== undefined) values.description = typeof body.description === "string" ? body.description.trim().slice(0, 1000) : undefined;
  if (body.presetAmounts !== undefined || !partial) {
    const raw = Array.isArray(body.presetAmounts) ? body.presetAmounts : [];
    const presets: DonationPreset[] = [];
    for (const p of raw.slice(0, MAX_PRESETS)) {
      const amount = typeof p === "number" ? p : (p as { amountMinor?: unknown })?.amountMinor;
      if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0 || amount > MAX_DONATION_MINOR) {
        return { error: "Each suggested amount must be a positive whole number in the smallest currency unit (e.g. 2500 for 25.00)." };
      }
      const label = typeof p === "object" && p && typeof (p as { label?: unknown }).label === "string" ? (p as { label: string }).label.trim().slice(0, 60) : undefined;
      presets.push({ amountMinor: amount, ...(label ? { label } : {}) });
    }
    if (presets.length === 0 && body.allowCustomAmount === false) return { error: "Add at least one suggested amount, or allow donors to enter their own." };
    values.presetAmounts = presets;
  }
  if (body.defaultPresetIndex !== undefined) values.defaultPresetIndex = Math.max(0, Number(body.defaultPresetIndex) | 0);
  if (body.allowCustomAmount !== undefined) values.allowCustomAmount = body.allowCustomAmount !== false;
  if (body.minAmountMinor !== undefined) {
    const min = Number(body.minAmountMinor);
    if (!Number.isInteger(min) || min < 1) return { error: "The minimum amount must be a positive whole number in the smallest currency unit." };
    values.minAmountMinor = min;
  }
  if (body.allowMonthly !== undefined) values.allowMonthly = body.allowMonthly !== false;
  if (body.defaultFrequency !== undefined) values.defaultFrequency = body.defaultFrequency === "MONTHLY" ? "MONTHLY" : "ONCE";
  if (body.goalAmountMinor !== undefined) {
    const goal = body.goalAmountMinor === null ? null : Number(body.goalAmountMinor);
    if (goal !== null && (!Number.isInteger(goal) || goal <= 0)) return { error: "The goal must be a positive whole number in the smallest currency unit, or empty." };
    values.goalAmountMinor = goal ?? undefined;
  }
  if (body.thankYouMessage !== undefined) values.thankYouMessage = typeof body.thankYouMessage === "string" ? body.thankYouMessage.trim().slice(0, 1000) : undefined;
  if (body.buttonLabel !== undefined) values.buttonLabel = typeof body.buttonLabel === "string" ? body.buttonLabel.trim().slice(0, 40) : undefined;
  if (body.active !== undefined) values.active = body.active !== false;
  return { values };
}

/** What a public donate form needs to render — never anything secret. */
export function publicCampaignView(campaign: CampaignItem, settings: SettingsItem | null) {
  const gateway = resolveDonationGateway(settings);
  return {
    id: campaign.id,
    name: campaign.name,
    description: campaign.description ?? null,
    presetAmounts: (campaign.presetAmounts as DonationPreset[]) ?? [],
    defaultPresetIndex: campaign.defaultPresetIndex ?? 0,
    allowCustomAmount: campaign.allowCustomAmount ?? true,
    minAmountMinor: campaign.minAmountMinor ?? 100,
    // Monthly giving needs a card gateway (bank transfer can't recur).
    allowMonthly: (campaign.allowMonthly ?? true) && gateway.gatewayReady,
    defaultFrequency: campaign.defaultFrequency ?? "ONCE",
    goalAmountMinor: campaign.goalAmountMinor ?? null,
    raisedMinor: campaign.raisedMinor ?? 0,
    donationCount: campaign.donationCount ?? 0,
    thankYouMessage: campaign.thankYouMessage ?? null,
    buttonLabel: campaign.buttonLabel ?? null,
    currency: settings?.currency ?? "NGN",
    accepting: Boolean(settings?.enabled) && (campaign.active ?? true) && (gateway.gatewayReady || gateway.bankTransferReady),
    bankTransferAvailable: gateway.bankTransferReady,
  };
}

interface DonationGateway {
  isStripe: boolean;
  stripe: { secretKey: string; publishableKey: string | null; isPlatform: boolean } | null;
  paystack: { secretKey: string; isPlatform: boolean } | null;
  gatewayReady: boolean;
  bankTransferReady: boolean;
}

/** The site's card gateway with its secret ready to use (decrypted for BYO, env for platform). */
export function resolveDonationGateway(settings: SettingsItem | null): DonationGateway {
  if (!settings) return { isStripe: false, stripe: null, paystack: null, gatewayReady: false, bankTransferReady: false };
  const provider = settings.paymentProvider ?? "BYO_PAYSTACK";
  const isStripe = provider === "PLATFORM_STRIPE" || provider === "BYO_STRIPE";
  let stripe: DonationGateway["stripe"] = null;
  let paystack: DonationGateway["paystack"] = null;
  if (isStripe) {
    const keys = resolveCheckoutStripeSecret({
      paymentProvider: provider,
      stripeMode: settings.stripeMode ?? "TEST",
      stripeTestPublishableKey: settings.stripeTestPublishableKey ?? null,
      stripeTestSecretKeyEncrypted: settings.stripeTestSecretKeyEncrypted ?? null,
      stripeTestWebhookSecretEncrypted: settings.stripeTestWebhookSecretEncrypted ?? null,
      stripeLivePublishableKey: settings.stripeLivePublishableKey ?? null,
      stripeLiveSecretKeyEncrypted: settings.stripeLiveSecretKeyEncrypted ?? null,
      stripeLiveWebhookSecretEncrypted: settings.stripeLiveWebhookSecretEncrypted ?? null,
    });
    if (keys?.secretKeyEncrypted) {
      try {
        stripe = { secretKey: keys.isPlatform ? keys.secretKeyEncrypted : decryptStripeKey(keys.secretKeyEncrypted), publishableKey: keys.publishableKey, isPlatform: keys.isPlatform };
      } catch {
        stripe = null;
      }
    }
  } else {
    const keys = resolveCheckoutPaystackSecret({
      paymentProvider: provider,
      paystackMode: settings.paystackMode ?? "TEST",
      paystackTestPublicKey: settings.paystackTestPublicKey ?? null,
      paystackTestSecretKeyEncrypted: settings.paystackTestSecretKeyEncrypted ?? null,
      paystackLivePublicKey: settings.paystackLivePublicKey ?? null,
      paystackLiveSecretKeyEncrypted: settings.paystackLiveSecretKeyEncrypted ?? null,
    });
    if (keys?.secretKeyEncrypted && keys.publicKey) {
      try {
        paystack = { secretKey: keys.isPlatform ? keys.secretKeyEncrypted : decryptPaystackKey(keys.secretKeyEncrypted), isPlatform: keys.isPlatform };
      } catch {
        paystack = null;
      }
    }
  }
  return { isStripe, stripe, paystack, gatewayReady: Boolean(stripe || paystack), bankTransferReady: isBankTransferReady(settings) };
}

function orderNumber(): string {
  return `DON-${randomBytes(4).toString("hex").toUpperCase()}`;
}

export interface StartDonationInput {
  templateId: string;
  organizationId: string;
  campaignId: string;
  amountMinor: number;
  frequency: "ONCE" | "MONTHLY";
  donorEmail: string;
  donorName: string | null;
  paymentMethod?: "ONLINE" | "BANK_TRANSFER";
  /** Absolute URL of the page the donation was made on — the donor returns here, thanked. */
  returnUrl: string;
}

export type StartDonationResult =
  | { orderNumber: string; checkout: { provider: "stripe"; clientSecret: string; publishableKey: string | null } }
  | { orderNumber: string; authorizationUrl: string }
  | { orderNumber: string; paymentMethod: "BANK_TRANSFER"; redirectUrl: string };

/**
 * Starts a gift: validates the amount against the campaign's rules (never trusting the
 * client), records a PENDING donation order, and hands back exactly what public/commerce.js
 * already knows how to finish — an embedded Stripe Checkout, a Paystack redirect, or the
 * bank-transfer instructions page.
 */
export async function startDonation(input: StartDonationInput): Promise<StartDonationResult> {
  const [{ data: campaign }, { data: settings }] = await Promise.all([
    CommerceDonationCampaign.get({ templateId: input.templateId, id: input.campaignId }).go(),
    CommerceSettings.get({ templateId: input.templateId }).go(),
  ]);
  if (!campaign || !(campaign.active ?? true)) throw new DonationError("This donation form isn't accepting donations right now.", 404);
  if (!settings?.enabled) throw new DonationError("This site isn't accepting donations yet — please check back soon.");

  const presets = (campaign.presetAmounts as DonationPreset[]) ?? [];
  const isPreset = presets.some((p) => p.amountMinor === input.amountMinor);
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0 || input.amountMinor > MAX_DONATION_MINOR) throw new DonationError("Please choose a donation amount.");
  if (!isPreset && !(campaign.allowCustomAmount ?? true)) throw new DonationError("Please choose one of the suggested amounts.");
  if (!isPreset && input.amountMinor < (campaign.minAmountMinor ?? 100)) {
    throw new DonationError(`The smallest donation is ${formatMoney(campaign.minAmountMinor ?? 100, settings.currency ?? "NGN")}.`);
  }

  const gateway = resolveDonationGateway(settings);
  const monthly = input.frequency === "MONTHLY";
  if (monthly && !(campaign.allowMonthly ?? true)) throw new DonationError("Monthly giving isn't available for this form.");
  const useBankTransfer = input.paymentMethod === "BANK_TRANSFER" ? gateway.bankTransferReady : !gateway.gatewayReady && gateway.bankTransferReady;
  if (!useBankTransfer && !gateway.gatewayReady) throw new DonationError("This site isn't accepting donations yet — please check back soon.");
  if (monthly && useBankTransfer) throw new DonationError("Monthly giving needs a card — choose a one-time gift to pay by bank transfer.");

  const currency = settings.currency ?? "NGN";
  const provider = settings.paymentProvider ?? "BYO_PAYSTACK";
  const orderId = randomUUID();
  const number = orderNumber();
  const subscriptionId = monthly ? randomUUID() : null;
  const paystackReference = !useBankTransfer && !gateway.isStripe ? `plx_${randomBytes(12).toString("hex")}` : undefined;
  const itemName = `${monthly ? "Monthly donation" : "Donation"} — ${campaign.name}`;

  if (subscriptionId) {
    await CommerceDonationSubscription.create({
      id: subscriptionId,
      templateId: input.templateId,
      organizationId: input.organizationId,
      campaignId: campaign.id,
      donorEmail: input.donorEmail,
      donorName: input.donorName ?? undefined,
      amountMinor: input.amountMinor,
      currency,
      paymentProvider: provider,
      status: "PENDING",
      manageToken: randomBytes(24).toString("base64url"),
      firstOrderId: orderId,
    }).go();
  }

  await CommerceOrder.create({
    id: orderId,
    templateId: input.templateId,
    organizationId: input.organizationId,
    orderNumber: number,
    customerEmail: input.donorEmail,
    customerName: input.donorName ?? undefined,
    amountMinor: input.amountMinor,
    currency,
    status: "PENDING",
    // Nothing to ship — a donation is complete the moment it's paid.
    fulfillmentStatus: "COMPLETED",
    paymentProvider: provider,
    paystackMode: paystackReference && !gateway.paystack?.isPlatform ? settings.paystackMode ?? "TEST" : undefined,
    paystackReference,
    paymentMethod: useBankTransfer ? "BANK_TRANSFER" : "ONLINE",
    bankTransferConfirmToken: useBankTransfer ? generateBankTransferToken() : undefined,
    metadata: { kind: "DONATION", campaignId: campaign.id, campaignName: campaign.name, frequency: input.frequency, subscriptionId },
  }).go();
  await CommerceOrderItem.create({
    id: randomUUID(),
    templateId: input.templateId,
    orderId,
    productId: `donation:${campaign.id}`,
    nameSnapshot: itemName,
    unitPriceMinor: input.amountMinor,
    quantity: 1,
  }).go();

  const returnUrl = new URL(input.returnUrl);
  returnUrl.searchParams.set("plexo_donation", "thanks");
  returnUrl.searchParams.set("order", number);
  const { data: order } = await CommerceOrder.get({ templateId: input.templateId, id: orderId }).go({ consistent: true });
  if (!order) throw new Error(`Donation order ${orderId} vanished immediately after being created`);

  if (useBankTransfer) {
    await notifyBankTransferPlaced(order, settings).catch((err) => console.error("Donations: bank transfer notify failed", err));
    const confirm = new URL("/order-confirmation", returnUrl.origin);
    confirm.searchParams.set("order", number);
    confirm.searchParams.set("email", input.donorEmail);
    return { orderNumber: number, paymentMethod: "BANK_TRANSFER", redirectUrl: confirm.toString() };
  }

  try {
    if (gateway.stripe) {
      const session = monthly
        ? await createCommerceStripeDonationSubscriptionSession({
            secretKey: gateway.stripe.secretKey,
            orderId,
            templateId: input.templateId,
            donationSubscriptionId: subscriptionId!,
            amountMinor: input.amountMinor,
            currency,
            customerEmail: input.donorEmail,
            description: itemName,
            returnUrl: returnUrl.toString(),
          })
        : await createCommerceStripeCheckoutSession({
            secretKey: gateway.stripe.secretKey,
            orderId,
            templateId: input.templateId,
            amountMinor: input.amountMinor,
            currency,
            customerEmail: input.donorEmail,
            productName: itemName,
            returnUrl: returnUrl.toString(),
          });
      await CommerceOrder.patch({ templateId: input.templateId, id: orderId }).set({ stripeCheckoutSessionId: session.id }).go();
      return { orderNumber: number, checkout: { provider: "stripe", clientSecret: session.clientSecret, publishableKey: gateway.stripe.publishableKey } };
    }

    const paystack = gateway.paystack!;
    let plan: string | undefined;
    if (monthly) {
      plan = await paystackPlanFor(campaign, paystack.secretKey, input.amountMinor, currency, settings.paystackMode ?? "TEST");
      await CommerceDonationSubscription.patch({ templateId: input.templateId, id: subscriptionId! }).set({ paystackPlanCode: plan }).go();
    }
    const result = await initializePaystackTransaction({
      secretKey: paystack.secretKey,
      email: input.donorEmail,
      amountMinor: input.amountMinor,
      currency,
      reference: paystackReference!,
      callbackUrl: returnUrl.toString(),
      metadata: { orderId, orderNumber: number, templateId: input.templateId, donationSubscriptionId: subscriptionId },
      plan,
    });
    await CommerceOrder.patch({ templateId: input.templateId, id: orderId }).set({ paystackAuthorizationUrl: result.authorizationUrl }).go();
    return { orderNumber: number, authorizationUrl: result.authorizationUrl };
  } catch (err) {
    await CommerceOrder.patch({ templateId: input.templateId, id: orderId }).set({ status: "FAILED" }).go();
    if (subscriptionId) await CommerceDonationSubscription.patch({ templateId: input.templateId, id: subscriptionId }).set({ status: "CANCELLED", cancelledBy: "payment-start-failed" }).go();
    const raw = err instanceof Error ? err.message : String(err);
    // A setup problem on the owner's payment account (not the donor's card): tell the
    // owner exactly what to fix, and give the donor a calm message instead of gateway jargon.
    const setupIssue = describePaymentSetupIssue(raw, currency, gateway.isStripe ? "Stripe" : "Paystack");
    if (setupIssue) {
      await CommerceDonationCampaign.patch({ templateId: input.templateId, id: campaign.id })
        .set({ paymentIssue: setupIssue, paymentIssueAt: new Date().toISOString() })
        .go()
        .catch(() => {});
      throw new DonationError(`Online donations in ${currency} aren't available here just yet — please try again soon, or contact the organization directly.`, 503);
    }
    throw new DonationError(raw || "Couldn't start the payment. Please try again.", 502);
  }
}

/** Recognizes gateway errors that mean the OWNER's account needs a change, and says what. */
export function describePaymentSetupIssue(message: string, currency: string, gatewayName: string): string | null {
  if (/currency/i.test(message) && /(not supported|unsupported|not enabled|invalid)/i.test(message)) {
    return `${gatewayName} refused a ${currency} donation: your ${gatewayName} account isn't set up to accept ${currency}. Either ask ${gatewayName} to enable ${currency} on your account, or connect a payment account that accepts it (Stripe accepts USD, EUR, GBP and more) in Commerce → Settings → Payments.`;
  }
  if (/invalid key|invalid api key|api key provided|authentication/i.test(message)) {
    return `${gatewayName} rejected your API keys. Re-copy them from your ${gatewayName} dashboard into Commerce → Settings → Payments.`;
  }
  return null;
}

/** Paystack plans are fixed-amount, so each distinct monthly amount gets one, created once and reused. */
async function paystackPlanFor(campaign: CampaignItem, secretKey: string, amountMinor: number, currency: string, mode: string): Promise<string> {
  const key = `${amountMinor}:${currency}:${mode}`;
  const plans = (campaign.paystackPlans as Record<string, string> | undefined) ?? {};
  if (plans[key]) return plans[key];
  const code = await createPaystackMonthlyPlan({ secretKey, name: `${campaign.name} — monthly ${formatMoney(amountMinor, currency)}`, amountMinor, currency });
  await CommerceDonationCampaign.patch({ templateId: campaign.templateId, id: campaign.id }).set({ paystackPlans: { ...plans, [key]: code } }).go();
  return code;
}

/**
 * Everything that happens once a donation is actually paid (first or renewal): campaign
 * totals move, a monthly gift becomes ACTIVE, and the donor gets a thank-you receipt (with a
 * link to stop a monthly gift). Called from handleOrderPaid, so it runs for every payment
 * path — Stripe and Paystack webhooks and owner-confirmed bank transfers alike.
 */
export async function handleDonationPaid(order: OrderItem, settings: SettingsItem, gatewayRefs: { stripeSubscriptionId?: string | null } = {}): Promise<void> {
  const meta = (order.metadata ?? {}) as { campaignId?: string; subscriptionId?: string | null; renewal?: boolean };
  if (meta.campaignId) {
    const { data: campaign } = await CommerceDonationCampaign.get({ templateId: order.templateId, id: meta.campaignId }).go();
    if (campaign) {
      let patch = CommerceDonationCampaign.patch({ templateId: order.templateId, id: campaign.id }).add({ raisedMinor: order.amountMinor, donationCount: 1 });
      // A gift went through, so any earlier payment-setup problem is resolved.
      if (campaign.paymentIssue) patch = patch.remove(["paymentIssue", "paymentIssueAt"]);
      await patch
        .go()
        .catch((err) => console.error("Donations: campaign totals update failed", err));
    }
  }

  let subscription: DonationSubscriptionItem | null = null;
  if (meta.subscriptionId) {
    const { data } = await CommerceDonationSubscription.get({ templateId: order.templateId, id: meta.subscriptionId }).go();
    subscription = data;
    if (subscription) {
      const now = new Date().toISOString();
      let patch = CommerceDonationSubscription.patch({ templateId: order.templateId, id: subscription.id })
        .set({ lastChargedAt: now, ...(subscription.status === "PENDING" || subscription.status === "PAST_DUE" ? { status: "ACTIVE" as const } : {}) })
        .add({ chargesCount: 1 });
      if (gatewayRefs.stripeSubscriptionId && !subscription.providerRef) patch = patch.set({ providerRef: gatewayRefs.stripeSubscriptionId });
      await patch.go();
    }
  }

  if (settings.notifyCustomerOnPaid === false) return;
  await sendDonationReceipt(order, subscription).catch((err) => console.error("Donations: receipt failed", err));
}

async function sendDonationReceipt(order: OrderItem, subscription: DonationSubscriptionItem | null): Promise<void> {
  const { data: settings } = await CommerceSettings.get({ templateId: order.templateId }).go();
  const apiKey = settings ? resolveMaildripApiKey(settings) : null;
  if (!apiKey) return;
  const meta = (order.metadata ?? {}) as { campaignId?: string; campaignName?: string };
  const [{ data: site }, brand, siteUrl, campaignRes] = await Promise.all([
    Template.get({ id: order.templateId }).go(),
    getOrgBrandDynamo(order.organizationId),
    resolveSitePublicUrl(order.templateId),
    meta.campaignId ? CommerceDonationCampaign.get({ templateId: order.templateId, id: meta.campaignId }).go() : Promise.resolve({ data: null }),
  ]);
  const siteName = site?.name ?? "our organization";
  const { subject, html } = buildDonationReceiptEmail({
    siteName,
    donorName: order.customerName ?? null,
    amountFormatted: formatMoney(order.amountMinor, order.currency ?? "NGN"),
    monthly: Boolean(subscription),
    campaignName: meta.campaignName ?? null,
    receiptNumber: order.orderNumber,
    dateIso: order.createdAt ?? new Date().toISOString(),
    thankYouMessage: campaignRes.data?.thankYouMessage ?? null,
    manageUrl: subscription ? `${siteUrl}/donation/manage?token=${encodeURIComponent(subscription.manageToken)}` : null,
    brand,
  });
  await sendCommerceEmail(apiKey, { to: order.customerEmail, subject, html, context: "commerce_donation_receipt", organizationId: order.organizationId, templateId: order.templateId });
}

/**
 * A monthly gift's later charge (the gateway billed it on its own) → a new PAID donation
 * order, so every month shows in Orders and moves the campaign total. Returns the order for
 * the caller to run through handleOrderPaid (receipt, owner notification, wallet).
 * Idempotent per gateway charge reference.
 */
export async function recordDonationRenewal(
  subscription: DonationSubscriptionItem,
  charge: { amountMinor: number; currency?: string | null; chargeRef: string; stripePaymentIntentId?: string | null; paystackReference?: string | null },
): Promise<OrderItem | null> {
  const orderId = `renewal-${charge.chargeRef}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
  const { data: existing } = await CommerceOrder.get({ templateId: subscription.templateId, id: orderId }).go();
  if (existing) return null;
  const { data: campaign } = await CommerceDonationCampaign.get({ templateId: subscription.templateId, id: subscription.campaignId }).go();
  const campaignName = campaign?.name ?? "Donation";
  try {
    await CommerceOrder.create({
      id: orderId,
      templateId: subscription.templateId,
      organizationId: subscription.organizationId,
      orderNumber: orderNumber(),
      customerEmail: subscription.donorEmail,
      customerName: subscription.donorName ?? undefined,
      amountMinor: charge.amountMinor,
      currency: (charge.currency ?? subscription.currency).toUpperCase(),
      status: "PAID",
      fulfillmentStatus: "COMPLETED",
      paymentProvider: subscription.paymentProvider,
      paymentMethod: "ONLINE",
      stripePaymentIntentId: charge.stripePaymentIntentId ?? undefined,
      paystackReference: charge.paystackReference ?? undefined,
      metadata: { kind: "DONATION", campaignId: subscription.campaignId, campaignName, frequency: "MONTHLY", subscriptionId: subscription.id, renewal: true },
    }).go();
  } catch (err) {
    const e = err as { name?: string; cause?: { name?: string } };
    if (e?.name === "ConditionalCheckFailedException" || e?.cause?.name === "ConditionalCheckFailedException") return null;
    throw err;
  }
  await CommerceOrderItem.create({
    id: randomUUID(),
    templateId: subscription.templateId,
    orderId,
    productId: `donation:${subscription.campaignId}`,
    nameSnapshot: `Monthly donation — ${campaignName}`,
    unitPriceMinor: charge.amountMinor,
    quantity: 1,
  }).go();
  const { data: order } = await CommerceOrder.get({ templateId: subscription.templateId, id: orderId }).go();
  return order;
}

/** Stops a monthly gift at the gateway and records who stopped it. Safe to call twice. */
export async function cancelDonationSubscription(subscription: DonationSubscriptionItem, cancelledBy: string): Promise<void> {
  if (subscription.status === "CANCELLED") return;
  if (subscription.providerRef) {
    const { data: settings } = await CommerceSettings.get({ templateId: subscription.templateId }).go();
    const gateway = resolveDonationGateway(settings);
    if (subscription.paymentProvider === "BYO_STRIPE" || subscription.paymentProvider === "PLATFORM_STRIPE") {
      if (!gateway.stripe) throw new DonationError("Stripe isn't connected any more, so this monthly gift can't be stopped from Plexo — cancel it in your Stripe dashboard.");
      await cancelStripeSubscription(gateway.stripe.secretKey, subscription.providerRef);
    } else {
      if (!gateway.paystack || !subscription.paystackEmailToken) {
        throw new DonationError("This monthly gift can't be stopped from Plexo yet — cancel it in your Paystack dashboard (Subscriptions).");
      }
      await disablePaystackSubscription({ secretKey: gateway.paystack.secretKey, code: subscription.providerRef, emailToken: subscription.paystackEmailToken });
    }
  }
  await CommerceDonationSubscription.patch({ templateId: subscription.templateId, id: subscription.id })
    .set({ status: "CANCELLED", cancelledAt: new Date().toISOString(), cancelledBy })
    .go();
}

/** Marks a monthly gift stopped because the gateway reported it ended (card expired, cancelled at the gateway). */
export async function markDonationSubscriptionEnded(providerRef: string, reason: string): Promise<void> {
  const { data } = await CommerceDonationSubscription.query.byProviderRef({ providerRef }).go();
  for (const sub of data) {
    if (sub.status === "CANCELLED") continue;
    await CommerceDonationSubscription.patch({ templateId: sub.templateId, id: sub.id })
      .set({ status: "CANCELLED", cancelledAt: new Date().toISOString(), cancelledBy: reason })
      .go();
  }
}

export async function findDonationSubscriptionByRef(providerRef: string): Promise<DonationSubscriptionItem | null> {
  const { data } = await CommerceDonationSubscription.query.byProviderRef({ providerRef }).go();
  return data[0] ?? null;
}

/**
 * Brings monthly donors from the previous site over without asking them to sign up again:
 * their recurring gifts keep billing on the same Stripe/Paystack account they always did —
 * this registers each one in Plexo so every future charge is recorded, receipted and
 * counted, and so they can be managed from the Donations dashboard. Only gifts not already
 * known to Plexo are added. Returns how many were adopted.
 */
export async function adoptExistingMonthlyDonors(templateId: string, organizationId: string, campaignId: string): Promise<{ adopted: number; skipped: number }> {
  const [{ data: settings }, { data: campaign }, { data: known }] = await Promise.all([
    CommerceSettings.get({ templateId }).go(),
    CommerceDonationCampaign.get({ templateId, id: campaignId }).go(),
    CommerceDonationSubscription.query.primary({ templateId }).go({ pages: "all" }),
  ]);
  if (!campaign) throw new DonationError("Donation campaign not found.", 404);
  const gateway = resolveDonationGateway(settings);
  if (!gateway.gatewayReady || !settings) throw new DonationError("Connect the same Stripe or Paystack account your old site used (Commerce → Settings → Payments) first.");
  const knownRefs = new Set(known.map((k) => k.providerRef).filter(Boolean));
  const provider = settings.paymentProvider ?? "BYO_PAYSTACK";
  let adopted = 0;
  let skipped = 0;

  const adopt = async (row: { ref: string; email: string | null; name: string | null; amountMinor: number; currency: string; paystackPlanCode?: string; paystackEmailToken?: string }) => {
    if (knownRefs.has(row.ref) || !row.email || row.amountMinor <= 0) {
      skipped += 1;
      return;
    }
    await CommerceDonationSubscription.create({
      id: randomUUID(),
      templateId,
      organizationId,
      campaignId,
      donorEmail: row.email,
      donorName: row.name ?? undefined,
      amountMinor: row.amountMinor,
      currency: row.currency,
      paymentProvider: provider,
      status: "ACTIVE",
      providerRef: row.ref,
      paystackPlanCode: row.paystackPlanCode,
      paystackEmailToken: row.paystackEmailToken,
      manageToken: randomBytes(24).toString("base64url"),
      source: "imported",
    }).go();
    adopted += 1;
  };

  if (gateway.stripe) {
    for (const sub of await listActiveStripeSubscriptions(gateway.stripe.secretKey)) {
      // Only monthly gifts — an account shared with other recurring products shouldn't have them pulled in.
      if (sub.interval !== "month" || sub.metadata.donationSubscriptionId) {
        skipped += 1;
        continue;
      }
      await adopt({ ref: sub.id, email: sub.customerEmail, name: sub.customerName, amountMinor: sub.amountMinor, currency: sub.currency });
    }
  } else if (gateway.paystack) {
    for (let page = 1; page <= 10; page++) {
      const subs = await listPaystackSubscriptions(gateway.paystack.secretKey, page);
      for (const sub of subs) {
        if (sub.status !== "active" || sub.plan?.interval !== "monthly") {
          skipped += 1;
          continue;
        }
        const name = [sub.customer?.first_name, sub.customer?.last_name].filter(Boolean).join(" ") || null;
        await adopt({
          ref: sub.subscription_code,
          email: sub.customer?.email ?? null,
          name,
          amountMinor: sub.amount,
          currency: sub.plan?.currency ?? settings.currency ?? "NGN",
          paystackPlanCode: sub.plan?.plan_code,
          paystackEmailToken: sub.email_token,
        });
      }
      if (subs.length < 100) break;
    }
  }
  return { adopted, skipped };
}

/** After checkout.session.completed for a monthly gift: remember Stripe's subscription id so renewals can find it. */
export async function attachStripeSubscriptionToDonation(order: OrderItem, stripeSubscriptionId: string | null | undefined): Promise<void> {
  const subscriptionId = (order.metadata as { subscriptionId?: string | null } | undefined)?.subscriptionId;
  if (!subscriptionId || !stripeSubscriptionId) return;
  await CommerceDonationSubscription.patch({ templateId: order.templateId, id: subscriptionId }).set({ providerRef: stripeSubscriptionId }).go();
}

interface StripeInvoiceLike {
  id: string;
  amount_paid?: number;
  currency?: string;
  billing_reason?: string | null;
  subscription?: string | { id: string } | null;
  payment_intent?: string | { id: string } | null;
  parent?: { subscription_details?: { subscription?: string | { id: string } | null } | null } | null;
}

function idOf(v: string | { id: string } | null | undefined): string | null {
  return !v ? null : typeof v === "string" ? v : v.id;
}

/**
 * Handles the Stripe events that only exist for recurring gifts. Returns any NEW PAID
 * donation orders (a monthly renewal) for the caller to finish with handleOrderPaid (and a
 * wallet credit on Plexo-managed Stripe). `expectedTemplateId` scopes a per-site webhook
 * so one site's endpoint can never record another site's charges.
 */
export async function processStripeDonationEvent(
  event: { type: string; data: { object: unknown } },
  expectedTemplateId: string | null,
): Promise<OrderItem[]> {
  if (event.type === "invoice.paid") {
    const invoice = event.data.object as StripeInvoiceLike;
    // The first month is recorded by checkout.session.completed — only later cycles here.
    if (invoice.billing_reason !== "subscription_cycle") return [];
    const ref = idOf(invoice.subscription) ?? idOf(invoice.parent?.subscription_details?.subscription);
    if (!ref) return [];
    const sub = await findDonationSubscriptionByRef(ref);
    if (!sub || (expectedTemplateId && sub.templateId !== expectedTemplateId)) return [];
    const order = await recordDonationRenewal(sub, {
      amountMinor: invoice.amount_paid ?? sub.amountMinor,
      currency: invoice.currency,
      chargeRef: invoice.id,
      stripePaymentIntentId: idOf(invoice.payment_intent),
    });
    return order ? [order] : [];
  }
  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as { id: string };
    const known = await findDonationSubscriptionByRef(sub.id);
    if (known && (!expectedTemplateId || known.templateId === expectedTemplateId)) await markDonationSubscriptionEnded(sub.id, "gateway");
  }
  if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object as StripeInvoiceLike;
    const ref = idOf(invoice.subscription) ?? idOf(invoice.parent?.subscription_details?.subscription);
    const known = ref ? await findDonationSubscriptionByRef(ref) : null;
    if (known && known.status === "ACTIVE" && (!expectedTemplateId || known.templateId === expectedTemplateId)) {
      await CommerceDonationSubscription.patch({ templateId: known.templateId, id: known.id }).set({ status: "PAST_DUE" }).go();
    }
  }
  return [];
}

/**
 * Paystack's recurring-gift events for one site. charge.success for a renewal carries no
 * reference Plexo created, so it's matched by plan + donor email; subscription.create tells
 * us the subscription code and email token needed to stop it later.
 */
export async function processPaystackDonationEvent(
  templateId: string,
  event: { event?: string; data?: Record<string, unknown> },
): Promise<OrderItem[]> {
  const data = (event.data ?? {}) as {
    reference?: string;
    amount?: number;
    currency?: string;
    subscription_code?: string;
    email_token?: string;
    plan?: { plan_code?: string } | null;
    customer?: { email?: string } | null;
  };
  const planCode = data.plan?.plan_code;
  const email = data.customer?.email?.toLowerCase();
  const findByPlan = async (statuses: string[]) => {
    if (!planCode || !email) return null;
    const { data: subs } = await CommerceDonationSubscription.query.primary({ templateId }).go({ pages: "all" });
    return subs.find((s) => s.paystackPlanCode === planCode && s.donorEmail.toLowerCase() === email && statuses.includes(s.status ?? "PENDING")) ?? null;
  };

  if (event.event === "subscription.create" && data.subscription_code) {
    const sub = (await findByPlan(["PENDING", "ACTIVE"])) ?? null;
    if (sub && !sub.providerRef) {
      await CommerceDonationSubscription.patch({ templateId, id: sub.id }).set({ providerRef: data.subscription_code, paystackEmailToken: data.email_token }).go();
    }
    return [];
  }
  if ((event.event === "subscription.disable" || event.event === "subscription.not_renew") && data.subscription_code) {
    const known = await findDonationSubscriptionByRef(data.subscription_code);
    if (known && known.templateId === templateId) await markDonationSubscriptionEnded(data.subscription_code, "gateway");
    return [];
  }
  if (event.event === "charge.success" && data.reference && planCode) {
    const sub = await findByPlan(["ACTIVE", "PAST_DUE"]);
    if (!sub) return [];
    const order = await recordDonationRenewal(sub, { amountMinor: data.amount ?? sub.amountMinor, currency: data.currency, chargeRef: data.reference, paystackReference: data.reference });
    return order ? [order] : [];
  }
  return [];
}

/**
 * Plexo-managed Paystack has one webhook for every site, and a renewal/subscription event
 * carries no Plexo ids — the plan code is what ties it back to a site. Low-volume path, so
 * a filtered scan (the same trade-off the platform webhook routes already make) is fine.
 */
export async function findTemplateForPaystackEvent(data: { plan?: { plan_code?: string } | null; subscription_code?: string }): Promise<string | null> {
  if (data.subscription_code) {
    const known = await findDonationSubscriptionByRef(data.subscription_code);
    if (known) return known.templateId;
  }
  const planCode = data.plan?.plan_code;
  if (!planCode) return null;
  let cursor: string | null = null;
  for (;;) {
    const page: { data: DonationSubscriptionItem[]; cursor: string | null } = await CommerceDonationSubscription.scan
      .where((attr, op) => op.eq(attr.paystackPlanCode, planCode))
      .go({ cursor });
    if (page.data[0]) return page.data[0].templateId;
    cursor = page.cursor;
    if (!cursor) return null;
  }
}

/**
 * Everything a site needs before its first donation can be taken, done for the owner:
 * Commerce switched on (without provisioning a shop), the site currency set when it's
 * still the untouched default, and the confirmation page bank-transfer donors land on.
 * Payment keys are the one thing only the owner can supply — the dashboard and the
 * migration report point them to Settings → Payments for that.
 */
export async function ensureDonationsReady(templateId: string, organizationId: string, userId: string, opts: { currency?: string | null } = {}): Promise<void> {
  await ensureOrderConfirmationPage(templateId, organizationId, userId);
  const { data: settings } = await CommerceSettings.get({ templateId }).go();
  if (!settings) return;
  const { data: anyOrder } = await CommerceOrder.query.primary({ templateId }).go({ limit: 1 });
  const currency = opts.currency && /^[A-Z]{3}$/.test(opts.currency) && anyOrder.length === 0 ? opts.currency : undefined;
  await CommerceSettings.patch({ templateId })
    .set({ enabled: true, ...(currency ? { currency } : {}) })
    .go();
}

/** Everything the Donations dashboard (and the MCP list tool) shows, in one read. */
export async function listDonationsOverview(templateId: string) {
  const [{ data: campaigns }, { data: subs }, { data: orders }, { data: settings }] = await Promise.all([
    CommerceDonationCampaign.query.primary({ templateId }).go({ pages: "all" }),
    CommerceDonationSubscription.query.primary({ templateId }).go({ pages: "all" }),
    CommerceOrder.query.primary({ templateId }).go({ pages: "all" }),
    CommerceSettings.get({ templateId }).go(),
  ]);
  const gifts = orders
    .filter((o) => isDonationOrder(o) && o.status !== "PENDING" && o.status !== "FAILED")
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  const paid = gifts.filter((o) => o.status === "PAID");
  const activeSubs = subs.filter((s) => s.status === "ACTIVE" || s.status === "PAST_DUE");
  const gateway = resolveDonationGateway(settings);
  return {
    currency: settings?.currency ?? "NGN",
    enabled: Boolean(settings?.enabled),
    paymentsReady: gateway.gatewayReady || gateway.bankTransferReady,
    monthlyReady: gateway.gatewayReady,
    totals: {
      raisedMinor: paid.reduce((sum, o) => sum + o.amountMinor, 0),
      gifts: paid.length,
      donors: new Set(paid.map((o) => o.customerEmail.toLowerCase())).size,
      monthlyDonors: activeSubs.length,
      monthlyRecurringMinor: activeSubs.reduce((sum, s) => sum + s.amountMinor, 0),
    },
    campaigns: campaigns
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
      .map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description ?? null,
        presetAmounts: (c.presetAmounts as DonationPreset[]) ?? [],
        defaultPresetIndex: c.defaultPresetIndex ?? 0,
        allowCustomAmount: c.allowCustomAmount ?? true,
        minAmountMinor: c.minAmountMinor ?? 100,
        allowMonthly: c.allowMonthly ?? true,
        defaultFrequency: c.defaultFrequency ?? "ONCE",
        goalAmountMinor: c.goalAmountMinor ?? null,
        raisedMinor: c.raisedMinor ?? 0,
        donationCount: c.donationCount ?? 0,
        thankYouMessage: c.thankYouMessage ?? null,
        buttonLabel: c.buttonLabel ?? null,
        active: c.active ?? true,
        source: c.source ?? null,
        paymentIssue: c.paymentIssue ?? null,
        monthlyDonors: activeSubs.filter((s) => s.campaignId === c.id).length,
      })),
    monthlyDonors: subs
      .filter((s) => s.status !== "PENDING")
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
      .map((s) => ({
        id: s.id,
        campaignId: s.campaignId,
        donorEmail: s.donorEmail,
        donorName: s.donorName ?? null,
        amountMinor: s.amountMinor,
        currency: s.currency,
        status: s.status,
        since: s.createdAt,
        chargesCount: s.chargesCount ?? 0,
        lastChargedAt: s.lastChargedAt ?? null,
        source: s.source ?? "plexo",
      })),
    recentGifts: gifts.slice(0, 50).map((o) => {
      const meta = (o.metadata ?? {}) as { campaignName?: string; frequency?: string; renewal?: boolean };
      return {
        id: o.id,
        orderNumber: o.orderNumber,
        donorEmail: o.customerEmail,
        donorName: o.customerName ?? null,
        amountMinor: o.amountMinor,
        currency: o.currency ?? "NGN",
        status: o.status,
        campaignName: meta.campaignName ?? null,
        monthly: meta.frequency === "MONTHLY",
        createdAt: o.createdAt,
      };
    }),
  };
}

export type DonationsOverview = Awaited<ReturnType<typeof listDonationsOverview>>;
