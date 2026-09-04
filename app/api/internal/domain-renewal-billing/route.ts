import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdmin } from "@/server/adminAuth";
import { isCronRequest } from "@/lib/cronAuth";
import { getStripe } from "@/lib/stripe";
import { resolveRegistrarProvider } from "@/lib/domains/registrarProvider";
import { resolveCommerceWallet, debitCommerceWalletForDomain, InsufficientWalletBalanceError } from "@/lib/commerce/walletDynamo";
import { sendMaildripEmail } from "@/lib/mail/maildrip";
import { buildDomainRenewalFailedEmail } from "@/lib/mail/templates";
import { logEmailDelivery } from "@/lib/mail/logEmail";
import { getOrgBrandDynamo } from "@/server/orgDynamo";
import { RegisteredDomain } from "@/lib/db/contentEntities";
import { User } from "@/lib/db/coreEntities";
import type { EntityItem } from "electrodb";

// Start attempting a renewal charge this many days before it's due — gives a few poller
// cycles' worth of runway for a first failed attempt to be fixed before the domain is
// actually at risk. Domains renew yearly, so a week's lead time costs nothing.
const RENEWAL_LOOKAHEAD_DAYS = 7;
// How long a domain keeps serving/billing-retrying after its own renewalDate before this
// poller gives up and marks it EXPIRED — real margin before Route53's own actual hard
// expiration/redemption-grace process, per the Buy-a-Domain plan's own note on not racing
// that.
const RENEWAL_GRACE_DAYS = 14;

type RegisteredDomainItem = EntityItem<typeof RegisteredDomain>;

function daysBetween(a: Date, b: Date): number {
  return (a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000);
}

async function chargeRenewal(row: RegisteredDomainItem): Promise<{ ok: true } | { ok: false; reason: string }> {
  const amountCents = row.renewalPriceUsdCents;
  if (!amountCents) return { ok: false, reason: "No renewal price on record." };

  if (row.paymentMethod === "WALLET") {
    try {
      const wallet = await resolveCommerceWallet(row.templateId, row.organizationId);
      if ((wallet.currency ?? "NGN") !== "USD") return { ok: false, reason: "Wallet is no longer USD-denominated." };
      await debitCommerceWalletForDomain(wallet, amountCents, row.id, "DOMAIN_RENEWAL_DEBIT", `Domain renewal: ${row.domain}`);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof InsufficientWalletBalanceError ? "Insufficient wallet balance." : err instanceof Error ? err.message : "Wallet debit failed." };
    }
  }

  if (!row.stripePaymentMethodId) return { ok: false, reason: "No saved payment method on file." };
  const { data: user } = await User.get({ id: row.userId }).go();
  if (!user?.stripeCustomerId) return { ok: false, reason: "No Stripe customer on file." };

  try {
    const stripe = getStripe();
    await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      customer: user.stripeCustomerId,
      payment_method: row.stripePaymentMethodId,
      off_session: true,
      confirm: true,
      description: `Domain renewal: ${row.domain}`,
      metadata: { kind: "domain_renewal", registeredDomainId: row.id, domain: row.domain },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "Off-session charge failed." };
  }
}

/**
 * GET /api/internal/domain-renewal-billing
 *
 * Daily — the customer-facing half of keeping a purchased domain renewed. Route53's own
 * native auto-renew is deliberately disabled once a domain goes ACTIVE (see
 * app/api/internal/certificate-attachment/route.ts's own comment) specifically so THIS
 * poller is the sole thing deciding whether a renewal actually happens, tied to whether the
 * customer's own payment succeeds — the whole point being no silent AWS-account-funded
 * renewal with no matching customer charge.
 *
 * Scans the ACTIVE and SUSPENDED_NONPAYMENT status buckets (RegisteredDomain's byStatus
 * GSI) rather than a renewalDate index that doesn't exist — same "honest v1, filter in
 * application code" discipline as this codebase's other admin/billing crons.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronRequest(request) && !isAuthorizedAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const [activeBatch, suspendedBatch] = await Promise.all([
    RegisteredDomain.query.byStatus({ status: "ACTIVE" }).go({ pages: "all" }),
    RegisteredDomain.query.byStatus({ status: "SUSPENDED_NONPAYMENT" }).go({ pages: "all" }),
  ]);

  const now = new Date();
  const dueSoon = activeBatch.data.filter((r) => {
    if (!r.autoRenew || !r.renewalDate) return false;
    return daysBetween(new Date(r.renewalDate), now) <= RENEWAL_LOOKAHEAD_DAYS;
  });
  const inGrace = suspendedBatch.data; // already past due once — retry every run until grace expires

  let renewed = 0;
  let stillFailing = 0;
  let expired = 0;
  const errors: string[] = [];

  for (const row of [...dueSoon, ...inGrace]) {
    try {
      const result = await chargeRenewal(row);

      if (result.ok) {
        const { kind, provider } = await resolveRegistrarProvider(row.domain);
        let nextRenewalDate: string | undefined;
        if (kind === "ROUTE53") {
          await provider.renew(row.domain);
          nextRenewalDate = await provider.getDomainDetail(row.domain).then((d) => d.expirationDate).catch(() => undefined);
        }
        await RegisteredDomain.patch({ templateId: row.templateId, id: row.id })
          .set({
            status: "ACTIVE",
            renewalAttemptCount: 0,
            ...(nextRenewalDate ? { renewalDate: nextRenewalDate } : {}),
          })
          .remove(["renewalGraceUntil", "lastRenewalFailureReason"])
          .go();
        renewed++;
        continue;
      }

      const attemptCount = (row.renewalAttemptCount ?? 0) + 1;
      const graceUntil = row.renewalGraceUntil ?? (() => {
        const d = new Date(row.renewalDate ?? now);
        d.setDate(d.getDate() + RENEWAL_GRACE_DAYS);
        return d.toISOString();
      })();
      const pastGrace = new Date(graceUntil).getTime() < now.getTime();

      const brand = await getOrgBrandDynamo(row.organizationId);
      const { data: user } = await User.get({ id: row.userId }).go();
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      const renewalPriceFormatted = row.renewalPriceUsdCents != null ? `$${(row.renewalPriceUsdCents / 100).toFixed(2)}` : "the renewal fee";

      if (pastGrace) {
        await RegisteredDomain.patch({ templateId: row.templateId, id: row.id })
          .set({ status: "EXPIRED", renewalAttemptCount: attemptCount, lastRenewalFailureReason: result.reason })
          .go();
        expired++;
        if (user?.email) {
          const subject = `${row.domain} has expired`;
          try {
            await sendMaildripEmail({
              to: user.email,
              subject,
              html: buildDomainRenewalFailedEmail({ domain: row.domain, renewalPriceFormatted, expired: true, manageUrl: `${appUrl}/dashboard/domains`, brand }),
            });
            logEmailDelivery({ kind: "maildrip", to: user.email, subject, status: "sent", context: "domain_renewal_failed", organizationId: row.organizationId, templateId: row.templateId });
          } catch (err) {
            logEmailDelivery({ kind: "maildrip", to: user.email, subject, status: "failed", errorMessage: err instanceof Error ? err.message : String(err), context: "domain_renewal_failed", organizationId: row.organizationId, templateId: row.templateId });
          }
        }
      } else {
        await RegisteredDomain.patch({ templateId: row.templateId, id: row.id })
          .set({ status: "SUSPENDED_NONPAYMENT", renewalAttemptCount: attemptCount, renewalGraceUntil: graceUntil, lastRenewalFailureReason: result.reason })
          .go();
        stillFailing++;
        // Only email on the FIRST failure (attemptCount === 1) — a daily retry that's
        // still failing shouldn't re-spam the same warning every run.
        if (attemptCount === 1 && user?.email) {
          const subject = `Renewal payment failed for ${row.domain}`;
          try {
            await sendMaildripEmail({
              to: user.email,
              subject,
              html: buildDomainRenewalFailedEmail({ domain: row.domain, renewalPriceFormatted, graceUntil, manageUrl: `${appUrl}/dashboard/domains`, brand }),
            });
            logEmailDelivery({ kind: "maildrip", to: user.email, subject, status: "sent", context: "domain_renewal_failed", organizationId: row.organizationId, templateId: row.templateId });
          } catch (err) {
            logEmailDelivery({ kind: "maildrip", to: user.email, subject, status: "failed", errorMessage: err instanceof Error ? err.message : String(err), context: "domain_renewal_failed", organizationId: row.organizationId, templateId: row.templateId });
          }
        }
      }
    } catch (err) {
      errors.push(`${row.domain}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return NextResponse.json({ checked: dueSoon.length + inGrace.length, renewed, stillFailing, expired, errors });
}
