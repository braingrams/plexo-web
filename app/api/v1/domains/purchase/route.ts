import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { resolveUser as resolveUserDynamo } from "@/lib/auth/resolveUser";
import { requirePermission as requirePermissionDynamo } from "@/server/requirePermissionDynamo";
import { getTierFeatures } from "@/lib/subscription";
import { resolveRegistrarProvider, type DomainContact } from "@/lib/domains/registrarProvider";
import { activateDomainRegistration } from "@/lib/domains/activateDomainRegistration";
import { resolveCommerceWallet, debitCommerceWalletForDomain, InsufficientWalletBalanceError } from "@/lib/commerce/walletDynamo";
import { Template, PublishedDomain, RegisteredDomain } from "@/lib/db/contentEntities";
import { User } from "@/lib/db/coreEntities";

const NAME_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

function isValidContact(value: unknown): value is DomainContact {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.firstName === "string" && c.firstName.trim().length > 0 &&
    typeof c.lastName === "string" && c.lastName.trim().length > 0 &&
    typeof c.email === "string" && c.email.includes("@") &&
    typeof c.phoneNumber === "string" && c.phoneNumber.trim().length > 0 &&
    typeof c.addressLine1 === "string" && c.addressLine1.trim().length > 0 &&
    typeof c.city === "string" && c.city.trim().length > 0 &&
    typeof c.countryCode === "string" && c.countryCode.trim().length === 2 &&
    typeof c.zipCode === "string" && c.zipCode.trim().length > 0
  );
}

/**
 * POST /api/v1/domains/purchase
 *
 * Re-quotes the live price (ListPrices values can drift between search and purchase — never
 * trust a cached quote from the search step), creates a RegisteredDomain row in
 * PENDING_PAYMENT, then funds it one of two ways:
 *
 * - `paymentMethod: "WALLET"` — debits the org's CommerceWallet synchronously
 *   (lib/commerce/walletDynamo.ts's debitCommerceWalletForDomain) and calls
 *   activateDomainRegistration() directly, right here, since there's no external payment
 *   processor and therefore no webhook to defer to. USD-wallet-only for now (see
 *   lib/commerce/walletDynamo.ts's own currency note) — Route53 Domains prices in USD and
 *   this app has no FX conversion anywhere.
 * - `paymentMethod: "STRIPE"` (default) — starts an embedded Stripe Checkout session;
 *   app/api/webhooks/stripe/route.ts calls activateDomainRegistration() once payment
 *   actually clears. `setup_future_usage: "off_session"` captures a reusable payment method
 *   for renewal billing (app/api/internal/domain-renewal-billing/route.ts) — this route never
 *   calls RegisterDomain itself, so a browser tab closed mid-checkout leaves nothing charged
 *   and nothing registered, just an abandoned PENDING_PAYMENT row.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUserDynamo(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const permissionError = requirePermissionDynamo(resolved.role, { domain: ["manage"] });
  if (permissionError) return permissionError;

  // Buying a domain is gated the same way connecting a CUSTOM domain already is (both end
  // up as a CUSTOM PublishedDomain row once DNS provisions) — see
  // app/api/v1/domains/route.ts's own POST handler for the identical check. Client-side
  // gating in domains-client.tsx exists too, but a paid action always needs the real
  // enforcement here, not just a UI hint.
  if (!getTierFeatures(resolved.subscriptionPlan).customDomainEnabled) {
    return NextResponse.json({ error: "Buying a domain requires a Pro or Ultra plan. Upgrade in Settings → Billing." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const templateId = typeof body.templateId === "string" ? body.templateId : undefined;
  const domain = typeof body.domain === "string" ? body.domain.trim().toLowerCase() : "";
  const contact = body.contact;
  const paymentMethod = body.paymentMethod === "WALLET" ? "WALLET" : "STRIPE";

  if (!templateId || !domain || !NAME_REGEX.test(domain)) {
    return NextResponse.json({ error: "Missing or invalid domain/template." }, { status: 400 });
  }
  if (!isValidContact(contact)) {
    return NextResponse.json({ error: "Registrant contact details are incomplete." }, { status: 400 });
  }

  const { data: template } = await Template.get({ id: templateId }).go();
  if (!template || template.organizationId !== resolved.organizationId) {
    return NextResponse.json({ error: "Template not found or unauthorized." }, { status: 404 });
  }

  const { data: existingDomain } = await PublishedDomain.query.byDomain({ domain }).go();
  if (existingDomain.length > 0) {
    return NextResponse.json({ error: "This domain is already connected to a Plexo site." }, { status: 409 });
  }

  const { kind, provider } = await resolveRegistrarProvider(domain);

  const [{ available }] = await provider.checkAvailability([domain]);
  if (!available) {
    return NextResponse.json({ error: `${domain} is no longer available.` }, { status: 409 });
  }

  let price;
  try {
    price = await provider.getPrice(domain);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not price this domain." }, { status: 502 });
  }

  const registeredDomainId = randomUUID();
  await RegisteredDomain.create({
    id: registeredDomainId,
    userId: resolved.userId,
    organizationId: resolved.organizationId,
    templateId,
    domain,
    registrarProvider: kind,
    status: "PENDING_PAYMENT",
    purchasePriceUsdCents: price.registrationPriceUsdCents,
    renewalPriceUsdCents: price.renewalPriceUsdCents,
    paymentMethod,
    registrantContactJson: JSON.stringify(contact),
    autoRenew: true,
  }).go();

  if (paymentMethod === "WALLET") {
    const wallet = await resolveCommerceWallet(templateId, resolved.organizationId);
    if ((wallet.currency ?? "NGN") !== "USD") {
      await RegisteredDomain.patch({ templateId, id: registeredDomainId })
        .set({ status: "PAYMENT_FAILED", statusReason: "Wallet is not USD-denominated." })
        .go();
      return NextResponse.json({ error: "Your wallet isn't in USD, so it can't fund a domain purchase yet — pay by card instead." }, { status: 400 });
    }

    try {
      await debitCommerceWalletForDomain(wallet, price.registrationPriceUsdCents, registeredDomainId, "DOMAIN_PURCHASE_DEBIT", `Domain purchase: ${domain}`);
    } catch (err) {
      const insufficientBalance = err instanceof InsufficientWalletBalanceError;
      await RegisteredDomain.patch({ templateId, id: registeredDomainId })
        .set({ status: "PAYMENT_FAILED", statusReason: err instanceof Error ? err.message : "Wallet debit failed." })
        .go();
      return NextResponse.json(
        { error: insufficientBalance ? "Insufficient wallet balance." : "Could not debit wallet." },
        { status: insufficientBalance ? 402 : 502 },
      );
    }

    const { data: freshRow } = await RegisteredDomain.get({ templateId, id: registeredDomainId }).go();
    if (freshRow) await activateDomainRegistration(freshRow);
    return NextResponse.json({ success: true, registeredDomainId, templateId });
  }

  const { data: user } = await User.get({ id: resolved.userId }).go();
  if (!user) throw new Error(`Session user ${resolved.userId} has no matching User record`);

  const stripe = getStripe();
  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: user.email, metadata: { plexoUserId: resolved.userId } });
    customerId = customer.id;
    await User.patch({ id: resolved.userId }).set({ stripeCustomerId: customerId }).go();
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  try {
    const checkoutSession = await stripe.checkout.sessions.create({
      ui_mode: "embedded_page",
      mode: "payment",
      customer: customerId,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: `Domain registration: ${domain} (1 year)` },
            unit_amount: price.registrationPriceUsdCents,
          },
          quantity: 1,
        },
      ],
      // Captures a reusable payment method on the resulting PaymentIntent — the webhook
      // (app/api/webhooks/stripe/route.ts) reads it back and stores it on the
      // RegisteredDomain row so app/api/internal/domain-renewal-billing/route.ts can charge
      // it off-session at renewal time without asking the customer to re-enter a card.
      payment_intent_data: { setup_future_usage: "off_session" },
      metadata: {
        plexoUserId: resolved.userId,
        kind: "domain_purchase",
        registeredDomainId,
        domain,
        templateId,
      },
      return_url: `${appUrl}/dashboard/domains?registeredDomainId=${registeredDomainId}&templateId=${templateId}&session_id={CHECKOUT_SESSION_ID}`,
    });
    await RegisteredDomain.patch({ templateId, id: registeredDomainId }).set({ paymentReference: checkoutSession.id }).go();
    return NextResponse.json({ clientSecret: checkoutSession.client_secret, registeredDomainId });
  } catch (err) {
    await RegisteredDomain.patch({ templateId, id: registeredDomainId })
      .set({ status: "PAYMENT_FAILED", statusReason: err instanceof Error ? err.message : "Could not start checkout." })
      .go();
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not start checkout." }, { status: 503 });
  }
}
