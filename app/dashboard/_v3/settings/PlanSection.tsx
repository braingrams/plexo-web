"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { ArrowRight, Check, CreditCard, Download, Mail } from "lucide-react";
import { getStripePromise } from "@/lib/stripeClientPromise";
import { startTrial } from "../../_components/trial";
import { usePricing } from "../../_components/usePricing";
import { startCheckout, type CheckoutBody } from "@/lib/billing/clientCheckout";
import { isPaidPlanId, type PaidPlanId } from "@/lib/plan/plans";
import { packLabel, useTopupPacks, type TopupPackInfo } from "../../_components/useTopupPacks";
import { Badge, Button, ButtonLink, Card, CardHeader, Modal } from "../ui";
import { errMsg, hubApi } from "../hub/hubApi";
import { ACTIVITY_LABELS, cancelExplanation, creditView, planName, planStatusLine, planView, plansAbove, priceSourceFrom, type PlanId, type PlanState, type PriceSource } from "@/lib/dashboardV3/billingView";
import { Notice, SectionHead } from "./bits";

export type ReceiptRow = {
  id: string;
  paidAt: string;
  description: string;
  detail: string | null;
  amountCents: number;
  refundedCents: number;
  currency: string;
  status: "PENDING" | "PAID" | "FAILED" | "REFUNDED" | "PARTIALLY_REFUNDED";
  receiptNumber: string | null;
  cardLast4: string | null;
  failureReason: string | null;
};
export type ActivityRow = { id: string; type: string; amount: number; description: string; createdAt: string };
export type CardSummary = { cardBrand: string | null; cardLast4: string | null; cardExpMonth: number | null; cardExpYear: number | null };

export type PlanSectionProps = {
  state: PlanState;
  trialAvailable: boolean;
  allowanceBalance: number;
  topupBalance: number;
  allowanceResetAt: string;
  activity: ActivityRow[];
  payments: ReceiptRow[];
  card: CardSummary;
  prices?: PriceSource;
  /** Preview: nothing is sent anywhere. */
  mock?: boolean;
};

const STATUS: Record<ReceiptRow["status"], { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  PAID: { label: "Paid", tone: "success" },
  PENDING: { label: "Waiting", tone: "warning" },
  FAILED: { label: "Didn't go through", tone: "danger" },
  REFUNDED: { label: "Refunded", tone: "neutral" },
  PARTIALLY_REFUNDED: { label: "Partly refunded", tone: "warning" },
};
const BRANDS: Record<string, string> = { visa: "Visa", mastercard: "Mastercard", amex: "Amex", discover: "Discover", jcb: "JCB", diners: "Diners", unionpay: "UnionPay" };
const money = (cents: number, currency: string) => {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${currency.toUpperCase()} ${(cents / 100).toFixed(2)}`;
  }
};
const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const safeReturn = (v: string | null): v is string => !!v && v.startsWith("/") && !v.startsWith("//") && !v.includes("://");
const FALLBACK_PACKS: TopupPackInfo[] = [
  { pack: "SMALL", credits: 2500, price: "$5" },
  { pack: "MEDIUM", credits: 10000, price: "$20" },
  { pack: "LARGE", credits: 25000, price: "$50" },
];

function EmailReceipt({ id, mock }: { id: string; mock?: boolean }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  return (
    <Button
      size="sm"
      variant="ghost"
      loading={state === "sending"}
      leftIcon={<Mail size={16} aria-hidden />}
      onClick={async () => {
        setState("sending");
        try {
          if (!mock) await hubApi(`/api/billing/receipts/${encodeURIComponent(id)}/email`, { method: "POST" }, "We couldn't send that email. Please try again.");
          setState("sent");
        } catch {
          setState("error");
        }
      }}
    >
      {state === "sent" ? "Sent to your email" : state === "error" ? "Couldn't send. Try again" : "Email me a copy"}
    </Button>
  );
}

export function PlanSection(props: PlanSectionProps) {
  const { state, trialAvailable, allowanceBalance, topupBalance, allowanceResetAt, activity, payments, card, prices: pricesProp, mock = false } = props;
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const packsLive = useTopupPacks();
  const { pricing } = usePricing();
  // Prices come from the price book in the person's own currency (a preview can pass its own).
  const prices: PriceSource = pricesProp ?? priceSourceFrom(pricing);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<{ tone: "info" | "bad"; text: string } | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const current = planView(state.plan, prices);
  const credits = creditView(allowanceBalance, topupBalance, allowanceResetAt);
  const cancelText = cancelExplanation(state);
  const packs: TopupPackInfo[] = Object.keys(packsLive).length ? Object.values(packsLive) : FALLBACK_PACKS;

  async function checkout(body: CheckoutBody, key: string, returnTo: string | null = null) {
    if (mock) return;
    setBusy(key);
    setError(null);
    const done = (text: string) => {
      setStatus({ tone: "info", text });
      setTimeout(() => (returnTo ? router.push(returnTo) : router.refresh()), 2000);
    };
    try {
      // Stripe's card form or Paystack's popup, whichever the server picks for this person's currency.
      const result = await startCheckout(returnTo ? { ...body, returnTo } : body);
      if (result.kind === "stripe") setSecret(result.clientSecret);
      else if (result.kind === "changed" || result.kind === "paid") done(result.message);
      else if (result.kind === "processing") setStatus({ tone: "info", text: result.message });
      else if (result.kind === "error") setError(result.message);
    } catch {
      setError("We couldn't start that. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function portal() {
    if (mock) return;
    setBusy("portal");
    setError(null);
    try {
      const data = await hubApi<{ url?: string }>("/api/billing/portal", { method: "POST" }, "We couldn't open your billing page. Please try again.");
      if (!data.url) throw new Error("We couldn't open your billing page. Please try again.");
      window.location.href = data.url;
    } catch (e) {
      setError(errMsg(e));
      setBusy(null);
    }
  }

  // Back from the payment form (Stripe returns with ?session_id=): confirm with our own server, then refresh.
  // Other pages that sell an upgrade send people here with ?upgrade= / ?addon= and we open the right payment form.
  useEffect(() => {
    if (mock) return;
    const sessionId = search.get("session_id");
    const upgrade = search.get("upgrade");
    const addon = search.get("addon");
    const returnTo = search.get("returnTo");
    if (!sessionId && !upgrade && !addon) return;
    router.replace(pathname);
    if (sessionId) {
      void hubApi<{ status?: string }>(`/api/billing/checkout/session?session_id=${encodeURIComponent(sessionId)}`, undefined, "We couldn't confirm your payment.")
        .then((d) => {
          if (d.status === "complete") {
            setStatus({ tone: "info", text: "Thank you. Your payment went through and your plan is updating now." });
            setTimeout(() => (safeReturn(returnTo) ? router.push(returnTo) : router.refresh()), 2000);
          } else setStatus({ tone: "info", text: "Your payment is still going through. Check back in a moment." });
        })
        .catch((e) => setStatus({ tone: "bad", text: errMsg(e) }));
    } else if (isPaidPlanId(upgrade) || upgrade === "ULTRA") {
      void checkout({ kind: "subscription", plan: upgrade === "ULTRA" ? "PRO" : upgrade }, `sub-${upgrade}`, safeReturn(returnTo) ? returnTo : null);
    } else if (addon === "funnel_slot") {
      void checkout({ kind: "funnel_addon_slot" }, "addon", safeReturn(returnTo) ? returnTo : null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const upgrades = plansAbove(state.plan);
  const shownPayments = showAll ? payments : payments.slice(0, 5);
  const cardLine = card.cardLast4 ? `${BRANDS[card.cardBrand ?? ""] ?? "Card"} ending ${card.cardLast4}${card.cardExpMonth && card.cardExpYear ? `, expires ${String(card.cardExpMonth).padStart(2, "0")}/${String(card.cardExpYear).slice(-2)}` : ""}` : null;

  return (
    <>
      <SectionHead title="Plan & billing">What you have, what it includes, and what you've paid.</SectionHead>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      {status ? <Notice tone={status.tone === "bad" ? "bad" : "info"}>{status.text}</Notice> : null}

      <Card data-tour="plan-current" padding="lg">
        <div className="plx-planhero">
          <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0, flex: "1 1 320px" }}>
            <span className="plx-eyebrow">Your plan</span>
            <div className="plx-planhero__name">
              <h2 className="plx-h1">{current.name}</h2>
              <Badge tone={state.plan === "FREE" ? "neutral" : "success"} dot>{state.basis === "TRIAL" ? "Free trial" : state.plan === "FREE" ? "Free" : "Active"}</Badge>
            </div>
            <p className="plx-body" style={{ margin: 0, maxWidth: 560 }}>{planStatusLine(state)}</p>
            {cardLine ? <p className="plx-small" style={{ margin: 0, display: "flex", gap: 8, alignItems: "center" }}><CreditCard size={16} aria-hidden /> {cardLine}</p> : null}
          </div>
          {state.paying ? (
            <Button variant="secondary" loading={busy === "portal"} onClick={portal}>Update card or see invoices</Button>
          ) : null}
        </div>
        <hr style={{ border: 0, borderTop: "1px solid var(--plx-border)", margin: "24px 0" }} />
        <h3 className="plx-h3" style={{ margin: "0 0 14px" }}>What&apos;s included</h3>
        <ul className="plx-ticks">
          {current.included.map((line) => (
            <li key={line}><Check size={18} aria-hidden /> <span>{line}</span></li>
          ))}
        </ul>
      </Card>

      {upgrades.length ? (
        <section className="plx-set__stack" data-tour="plan-upgrade" aria-labelledby="up-h">
          <h2 className="plx-h2" id="up-h">{state.plan === "FREE" ? "Need more?" : "Want even more?"}</h2>
          <div className="plx-plans">
            {upgrades.map((id: PlanId, i) => {
              const v = planView(id, prices);
              return (
                <Card key={id} tone={i === 0 ? "tint" : "surface"}>
                  <CardHeader title={v.name} description={v.tagline} action={v.price ? <b>{v.price}</b> : undefined} />
                  <ul className="plx-ticks" style={{ marginBottom: 20 }}>
                    {v.included.map((line) => (
                      <li key={line}><Check size={18} aria-hidden /> <span>{line}</span></li>
                    ))}
                  </ul>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <Button loading={busy === `sub-${id}`} rightIcon={<ArrowRight size={18} aria-hidden />} onClick={() => checkout({ kind: "subscription", plan: id as PaidPlanId }, `sub-${id}`)}>
                      {state.plan === "FREE" ? `Choose ${v.name}` : `Switch to ${v.name}`}
                    </Button>
                    {state.plan === "FREE" && trialAvailable && id !== "ENTERPRISE" ? (
                      <Button
                        variant="secondary"
                        loading={busy === `trial-${id}`}
                        onClick={async () => {
                          if (mock) return;
                          setBusy(`trial-${id}`);
                          try {
                            await startTrial(id as "STARTER" | "PRO");
                          } catch (e) {
                            setError(errMsg(e));
                            setBusy(null);
                          }
                        }}
                      >
                        Try free for 14 days
                      </Button>
                    ) : null}
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      ) : null}

      <div className="plx-set__grid">
        <Card data-tour="plan-credits">
          <CardHeader title="AI credits" description="Credits are what SOL uses when it builds or writes for you." />
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 20 }}>
            <span className="plx-bigstat">{credits.total.toLocaleString("en-US")}</span>
            <span className="plx-small">
              {credits.negative ? "SOL finished your last job after your credits ran out. We take that off your next credits." : `${credits.allowance.toLocaleString("en-US")} from your plan, which refill in ${credits.resetsInDays} day${credits.resetsInDays === 1 ? "" : "s"}. ${credits.topup.toLocaleString("en-US")} you bought, which never run out.`}
            </span>
          </div>
          {credits.low || credits.negative ? <Notice tone="warn">Running low? Top up below and SOL carries on straight away.</Notice> : null}
          <h3 className="plx-h3" style={{ margin: "16px 0 12px" }}>Add more credits</h3>
          <div className="plx-packs">
            {packs.map((p) => (
              <button key={p.pack} type="button" className="plx-pack" disabled={busy !== null} onClick={() => checkout({ kind: "topup", pack: p.pack }, `topup-${p.pack}`)}>
                <b>{busy === `topup-${p.pack}` ? "Opening…" : packLabel(p)}</b>
                <span>{p.price}</span>
              </button>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Recent AI use" description="What your credits were spent on lately." />
          {activity.length === 0 ? (
            <p className="plx-body" style={{ margin: 0 }}>Nothing yet. When SOL builds something for you, it shows up here.</p>
          ) : (
            <ul className="plx-list" style={{ margin: "0 -20px" }}>
              {activity.slice(0, 6).map((a) => (
                <li key={a.id} className="plx-row" style={{ minHeight: 60 }}>
                  <div className="plx-row__main">
                    <span className="plx-row__title">{a.description || ACTIVITY_LABELS[a.type] || "Credits"}</span>
                    <span className="plx-row__sub">{when(a.createdAt)}</span>
                  </div>
                  <span className="plx-row__price" style={{ color: a.amount >= 0 ? "var(--plx-deep)" : undefined }}>{a.amount >= 0 ? "+" : ""}{a.amount.toLocaleString("en-US")}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card padding="none" className="plx-listcard" data-tour="plan-payments">
        <div style={{ padding: "20px 20px 8px" }}>
          <CardHeader title="Payments & receipts" description="Everything you've paid Plexo. Download a receipt any time." />
        </div>
        {payments.length === 0 ? (
          <p className="plx-body" style={{ padding: "0 20px 20px", margin: 0 }}>No payments yet. When you subscribe or buy credits, your receipts appear here.</p>
        ) : (
          <>
            <div>
              {shownPayments.map((p) => {
                const st = STATUS[p.status];
                const settled = p.status === "PAID" || p.status === "REFUNDED" || p.status === "PARTIALLY_REFUNDED";
                return (
                  <div key={p.id} className="plx-receipt">
                    <div className="plx-receipt__main">
                      <b>{p.description}</b>
                      <span className="plx-small">{when(p.paidAt)}{p.cardLast4 ? ` · card ending ${p.cardLast4}` : ""}</span>
                      {p.failureReason ? <span className="plx-small" style={{ color: "var(--plx-danger)" }}>{p.failureReason}</span> : null}
                    </div>
                    <span className="plx-receipt__amt">{money(p.amountCents, p.currency)}</span>
                    <Badge tone={st.tone}>{st.label}</Badge>
                    <div className="plx-receipt__end">
                      {settled ? (
                        <>
                          <ButtonLink size="sm" variant="secondary" href={`/api/billing/receipts/${encodeURIComponent(p.id)}`} leftIcon={<Download size={16} aria-hidden />}>
                            Receipt
                          </ButtonLink>
                          <EmailReceipt id={p.id} mock={mock} />
                        </>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
            {payments.length > 5 && !showAll ? (
              <div style={{ padding: 16, borderTop: "1px solid var(--plx-border)" }}>
                <Button variant="ghost" onClick={() => setShowAll(true)}>Show all {payments.length} payments</Button>
              </div>
            ) : null}
          </>
        )}
      </Card>

      {cancelText ? (
        <Card tone="elevated">
          <CardHeader title="Cancel your plan" description={cancelText} />
          <Button variant="secondary" loading={busy === "portal"} onClick={portal}>I want to cancel</Button>
          <p className="plx-small" style={{ margin: "10px 0 0" }}>We&apos;ll open a secure page where you can cancel. You&apos;ll keep {planName(state.plan)} until the date shown there.</p>
        </Card>
      ) : null}

      <Modal open={!!secret} onClose={() => setSecret(null)} title="Pay securely" width={600}>
        {secret ? (
          <div className="plx-checkout">
            <EmbeddedCheckoutProvider stripe={getStripePromise()} options={{ clientSecret: secret }}>
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
