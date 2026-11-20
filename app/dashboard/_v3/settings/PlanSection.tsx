"use client";

import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { ArrowRight, Check, CreditCard, Download, HelpCircle, Mail } from "lucide-react";
import { getStripePromise } from "@/lib/stripeClientPromise";
import { startTrial } from "../../_components/trial";
import { usePricing } from "../../_components/usePricing";
import { startCheckout, type CheckoutBody } from "@/lib/billing/clientCheckout";
import { isPaidPlanId, type PaidPlanId, PLAN, RETIRED_PLAN, TrialPlanId } from "@/lib/plan/plans";
import { currencySymbolFor, maxTopupAmount, minTopupAmount } from "@/lib/billing/pricing";
import { useTopupPacks, type TopupPackInfo } from "../../_components/useTopupPacks";
import { Badge, Button, ButtonLink, Card, Modal, SegmentedControl } from "../ui";
import { getTierFeatures } from "@/lib/subscription";
import { planMonthlyCredits } from "@/lib/credits/value";
import { creditMeter, usageMeter } from "@/lib/dashboardV3/settingsUsage";
import { errMsg, hubApi } from "../hub/hubApi";
import { ACTIVITY_LABELS, cancelExplanation, creditView, formatAiActivityDescription, planName, planStatusLine, planView, plansAbove, priceSourceFrom, type PlanId, type PlanState, type PriceSource } from "@/lib/dashboardV3/billingView";
import { AsideCard, AsideStats, DangerCard, Notice, Panel, SettingsPageShell, UsageMeter } from "./bits";

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

export type PlanUsage = { sites: number; products: number; teammates: number };

export type PlanSectionProps = {
  state: PlanState;
  trialAvailable: boolean;
  allowanceBalance: number;
  topupBalance: number;
  allowanceResetAt: string;
  activity: ActivityRow[];
  payments: ReceiptRow[];
  card: CardSummary;
  /** What the account uses now, for the meters (teammates = people besides the owner). */
  usage?: PlanUsage;
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
  const { state, trialAvailable, allowanceBalance, topupBalance, allowanceResetAt, activity, payments, card, prices: pricesProp, usage = { sites: 0, products: 0, teammates: 0 }, mock = false } = props;
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
  const [picking, setPicking] = useState<PaidPlanId | null>(null);
  const [pickInterval, setPickInterval] = useState<"monthly" | "yearly">("monthly");
  const [pickRenew, setPickRenew] = useState<"auto" | "once">("auto");

  const current = planView(state.plan, prices);
  const credits = creditView(allowanceBalance, topupBalance, allowanceResetAt);
  const cancelText = cancelExplanation(state);
  const packs: TopupPackInfo[] = Object.keys(packsLive).length ? Object.values(packsLive) : FALLBACK_PACKS;

  const [customAmountStr, setCustomAmountStr] = useState<string>("");
  const activeCurrency = pricing?.currency ?? (packs[0]?.price?.startsWith("₦") ? "NGN" : "USD");
  const ratePer1000 = pricing?.topup?.per1000 ?? (activeCurrency === "NGN" ? 1500 : 1);
  const minCustomAmount = minTopupAmount(activeCurrency);
  const maxCustomAmount = maxTopupAmount(activeCurrency);
  const currencySymbol = currencySymbolFor(activeCurrency);

  const numCustomAmount = parseFloat(customAmountStr.replace(/,/g, "").trim());
  const hasValidCustomNum = !isNaN(numCustomAmount) && numCustomAmount >= minCustomAmount && numCustomAmount <= maxCustomAmount;
  const customCalculatedCredits = hasValidCustomNum && ratePer1000 > 0 ? Math.max(0, Math.round((numCustomAmount / ratePer1000) * 1000)) : 0;

  function openPicker(id: PaidPlanId) {
    setPickInterval("monthly");
    setPickRenew("auto");
    setPicking(id);
  }

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
    const payOnce = search.get("payOnce");
    const topup = search.get("topup");
    const payOnceInterval = search.get("interval") === "yearly" ? ("yearly" as const) : ("monthly" as const);
    const returnTo = search.get("returnTo");
    if (!sessionId && !upgrade && !addon && !payOnce && !topup) return;
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
    } else if (isPaidPlanId(payOnce)) {
      // The "pay again" link in the reminder email: straight to paying once for that plan.
      void checkout({ kind: "subscription", plan: payOnce, interval: payOnceInterval, oneTime: true }, `once-${payOnce}`, safeReturn(returnTo) ? returnTo : null);
    } else if (isPaidPlanId(upgrade) || upgrade === RETIRED_PLAN.ULTRA) {
      void checkout({ kind: "subscription", plan: upgrade === RETIRED_PLAN.ULTRA ? PLAN.PRO : upgrade }, `sub-${upgrade}`, safeReturn(returnTo) ? returnTo : null);
    } else if (topup) {
      // "Top up credits" from an out-of-credits prompt (or an assistant's link): straight to the payment form for a medium pack.
      const pack = topup === "SMALL" || topup === "LARGE" ? topup : "MEDIUM";
      void checkout({ kind: "topup", pack }, `topup-${pack}`, safeReturn(returnTo) ? returnTo : null);
    } else if (addon === "funnel_slot") {
      void checkout({ kind: "funnel_addon_slot" }, "addon", safeReturn(returnTo) ? returnTo : null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const upgrades = plansAbove(state.plan);
  // Local-currency (Paystack) customers can also pay for one period, by transfer or card, with no automatic renewal. Not offered on top of a plan that renews by itself.
  const payOnceOffered = pricing?.provider === "PAYSTACK" && (!state.paying || !!state.oneTime);
  const shownPayments = showAll ? payments : payments.slice(0, 5);
  const cardLine = card.cardLast4 ? `${BRANDS[card.cardBrand ?? ""] ?? "Card"} ending ${card.cardLast4}${card.cardExpMonth && card.cardExpYear ? `, expires ${String(card.cardExpMonth).padStart(2, "0")}/${String(card.cardExpYear).slice(-2)}` : ""}` : null;

  const features = getTierFeatures(state.plan, { trial: state.basis === "TRIAL" });
  const monthly = planMonthlyCredits(state.plan);
  const siteMeter = usageMeter(usage.sites, features.maxPublishedSites);
  const productMeter = usageMeter(usage.products, features.maxCommerceProducts);
  const seatMeter = usageMeter(usage.teammates, features.teamSeats);
  const creditsMeter = creditMeter(allowanceBalance, monthly);
  const nextPlan = upgrades[0];

  return (
    <SettingsPageShell
      title="Plan & billing"
      purpose="What you have, what you're using, and what you've paid."
      below={
        <>
        {upgrades.length ? (
          <section id="plans" className="plx-sp__main" data-tour="plan-upgrade" aria-labelledby="up-h" style={{ scrollMarginTop: 90 }}>
            <div>
              <h3 className="plx-h2" id="up-h">{state.plan === PLAN.FREE ? "Pick a plan that fits" : "Want even more?"}</h3>
              <p className="plx-body" style={{ marginTop: 4 }}>Prices are in your own currency. Change or cancel any time.{payOnceOffered ? " Choose monthly or yearly, and whether it renews by itself." : ""}</p>
            </div>
            <div className="plx-plans" style={{ ["--plx-plan-count" as string]: Math.min(upgrades.length, 3) }}>
              {upgrades.map((id: PlanId, i) => {
                const v = planView(id, prices);
                return (
                  <Card key={id} tone={i === 0 ? "tint" : "surface"} padding="none" className="plx-panel plx-plan">
                    <div>
                      <h3 className="plx-h3">{v.name}</h3>
                      <p className="plx-small" style={{ margin: "4px 0 0" }}>{v.tagline}</p>
                    </div>
                    {v.price ? <div className="plx-plan__price">{v.price.replace(/ a month$/, "")}<small>{v.price.endsWith("a month") ? "a month" : ""}</small></div> : null}
                    <ul className="plx-ticks">
                      {v.included.map((line) => (
                        <li key={line}><Check size={18} aria-hidden /> <span>{line}</span></li>
                      ))}
                    </ul>
                    <div className="plx-plan__actions">
                      <Button variant={i === 0 ? "primary" : "secondary"} rightIcon={<ArrowRight size={18} aria-hidden />} onClick={() => openPicker(id as PaidPlanId)}>
                        {state.plan === PLAN.FREE ? `Choose ${v.name}` : `Switch to ${v.name}`}
                      </Button>
                      {state.plan === PLAN.FREE && trialAvailable && id !== PLAN.ENTERPRISE ? (
                        <Button
                          variant="ghost"
                          loading={busy === `trial-${id}`}
                          onClick={async () => {
                            if (mock) return;
                            setBusy(`trial-${id}`);
                            try {
                              await startTrial(id as TrialPlanId);
                            } catch (e) {
                              setError(errMsg(e));
                              setBusy(null);
                            }
                          }}
                        >
                          Try 14 days free
                        </Button>
                      ) : null}
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>
          ) : null}
      <Panel title="AI credits" description="Credits are what SOL uses when it builds or writes for you." data-tour="plan-credits" flush>
          <div style={{ padding: "0 28px 24px", display: "flex", flexDirection: "column", gap: 24 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="plx-bigstat">{credits.total.toLocaleString("en-US")}</span>
              <span className="plx-small">
                {credits.negative ? "SOL finished your last job after your credits ran out. We take that off your next credits." : `${credits.allowance.toLocaleString("en-US")} from your plan, which refill in ${credits.resetsInDays} day${credits.resetsInDays === 1 ? "" : "s"}. ${credits.topup.toLocaleString("en-US")} you bought, which never run out.`}
              </span>
            </div>
            {credits.low || credits.negative ? <Notice tone="warn">Running low? Top up below and SOL carries on straight away.</Notice> : null}
            <div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
                <h3 className="plx-h3" style={{ margin: 0 }}>Add more credits</h3>
                <p className="plx-small" style={{ color: "var(--plx-muted)", margin: 0 }}>
                  Choose from ready-made credit packs or enter the exact amount you want to buy. Credits you buy never expire.
                </p>
              </div>

              {/* 1. Credit packs */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: "var(--plx-text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                  <span>Credit packs</span>
                </div>
                <div className="plx-packs">
                  {packs.map((p) => (
                    <div key={p.pack} className="plx-sppack">
                      <div className="plx-sppack__amt">
                        <b>{p.credits.toLocaleString("en-US")}</b>
                        <span>credits</span>
                      </div>
                      <div className="plx-sppack__price">{p.price}</div>
                      <Button variant="secondary" fullWidth disabled={busy !== null && busy !== `topup-${p.pack}`} loading={busy === `topup-${p.pack}`} onClick={() => checkout({ kind: "topup", pack: p.pack }, `topup-${p.pack}`)}>
                        Buy
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              {/* 2. Buy what you need */}
              <div style={{ padding: "18px 20px", borderRadius: 16, border: "1px solid var(--plx-border)", background: "var(--plx-elevated)" }}>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>Buy what you need</div>
                  <div className="plx-small" style={{ color: "var(--plx-muted)", marginTop: 2 }}>
                    Enter any amount and get credits worth that upfront ({currencySymbol}{ratePer1000.toLocaleString("en-US")} gives 1,000 credits).
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ position: "relative", display: "inline-flex", alignItems: "center", minWidth: 140, flex: "0 1 auto" }}>
                    <span style={{ position: "absolute", left: 12, fontWeight: 700, color: "var(--plx-muted)", pointerEvents: "none" }}>{currencySymbol}</span>
                    <input
                      type="number"
                      min={minCustomAmount}
                      max={maxCustomAmount}
                      step="any"
                      placeholder={activeCurrency === "NGN" ? "1000" : "2"}
                      value={customAmountStr}
                      onChange={(e) => setCustomAmountStr(e.target.value)}
                      style={{
                        paddingLeft: currencySymbol.length > 2 ? 46 : 28,
                        paddingRight: 12,
                        height: 42,
                        borderRadius: 10,
                        border: "1px solid var(--plx-border)",
                        background: "var(--plx-bg)",
                        color: "var(--plx-text)",
                        fontSize: 15,
                        fontWeight: 700,
                        width: "100%",
                        maxWidth: 160,
                      }}
                      aria-label="Enter price to buy credits"
                    />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: "var(--plx-muted)", fontWeight: 700 }}>→</span>
                    <span style={{ fontWeight: 800, fontSize: 17, color: customCalculatedCredits > 0 ? "var(--plx-text)" : "var(--plx-muted)" }}>
                      {customCalculatedCredits > 0 ? `${customCalculatedCredits.toLocaleString("en-US")} credits` : "0 credits"}
                    </span>
                  </div>
                  <Button
                    variant="secondary"
                    disabled={!hasValidCustomNum || busy !== null}
                    loading={busy === "topup-custom"}
                    onClick={() => checkout({ kind: "topup", customAmount: numCustomAmount }, "topup-custom")}
                    style={{ marginLeft: "auto" }}
                  >
                    Buy {customCalculatedCredits > 0 ? `${customCalculatedCredits.toLocaleString("en-US")} credits` : "credits"}
                  </Button>
                </div>
                {customAmountStr.trim() !== "" && !hasValidCustomNum ? (
                  <div className="plx-small" style={{ color: "var(--plx-danger)", marginTop: 8 }}>
                    {numCustomAmount > maxCustomAmount ? `The most you can top up at once is ${currencySymbol}${maxCustomAmount.toLocaleString("en-US")}.` : `Minimum amount is ${currencySymbol}${minCustomAmount.toLocaleString("en-US")}.`}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          <div style={{ borderTop: "1px solid var(--plx-border)" }}>
            <h3 className="plx-h3" style={{ padding: "20px 28px 4px" }}>Recent AI use</h3>
            {activity.length === 0 ? (
              <p className="plx-body" style={{ padding: "4px 28px 24px" }}>Nothing yet. When SOL builds something for you, it shows up here.</p>
            ) : (
              <ul className="plx-list" style={{ paddingBottom: 8 }}>
                {activity.slice(0, 5).map((a) => (
                  <li key={a.id} className="plx-sprow" style={{ minHeight: 60, padding: "12px 28px" }}>
                    <div className="plx-sprow__main">
                      <span className="plx-sprow__title">{formatAiActivityDescription(a.description, a.type)}</span>
                      <span className="plx-sprow__sub">{when(a.createdAt)}</span>
                    </div>
                    <span className="plx-sprow__price" style={{ color: a.amount >= 0 ? "var(--plx-deep)" : undefined }}>{a.amount >= 0 ? "+" : ""}{a.amount.toLocaleString("en-US")}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>

        <Panel title="Payments & receipts" description="Everything you've paid Plexo. Download a receipt any time." flush data-tour="plan-payments">
          {payments.length === 0 ? (
            <p className="plx-body" style={{ padding: "0 28px 28px" }}>No payments yet. When you subscribe or buy credits, your receipts appear here.</p>
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
        </Panel>

        {cancelText ? (
          <DangerCard title="Cancel your plan" description={cancelText}>
            <Button variant="danger" loading={busy === "portal"} onClick={portal}>I want to cancel</Button>
            <p className="plx-small" style={{ margin: "12px 0 0", color: "var(--plx-text)" }}>We&apos;ll open a secure page where you can cancel. You&apos;ll keep {planName(state.plan)} until the date shown there.</p>
          </DangerCard>
        ) : null}
        <div className="plx-sp__split">
            <AsideCard title={`What ${current.name} includes`} icon={Check}>
              <ul>
                {current.included.map((line) => (
                  <li key={line}><Check size={16} aria-hidden /> <span>{line}</span></li>
                ))}
              </ul>
            </AsideCard>
            <AsideCard title="What happens if…" icon={HelpCircle}>
              <ul>
                <li><ArrowRight size={16} aria-hidden /> <span><b>I upgrade?</b> The new plan starts straight away, and only the difference is charged.</span></li>
                <li><ArrowRight size={16} aria-hidden /> <span><b>I run out of AI credits?</b> Top up any time. Credits you buy never expire.</span></li>
                <li><ArrowRight size={16} aria-hidden /> <span><b>I cancel?</b> You keep your plan until the end of what you&apos;ve paid for. Nothing is deleted.</span></li>
              </ul>
            </AsideCard>
        </div>
        </>
      }
      aside={
        <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
          <AsideCard title={`Your ${current.name} plan`} icon={CreditCard} style={{ height: "100%", display: "flex", flexDirection: "column" }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <AsideStats items={[
                { label: siteMeter.limit ? "Sites live" : "Sites", value: siteMeter.limit ? `${siteMeter.used} of ${siteMeter.limit}` : siteMeter.used, tone: siteMeter.tone === "ok" ? undefined : "warn" },
                { label: "AI credits left", value: allowanceBalance.toLocaleString("en-US"), tone: creditsMeter.tone === "full" ? "bad" : creditsMeter.tone === "near" ? "warn" : "ok" },
              ]} />
            </div>
          </AsideCard>
        </div>
      }
    >
      {error ? <GateOrError error={error}><Notice tone="bad">{error}</Notice></GateOrError> : null}
      {status ? <Notice tone={status.tone === "bad" ? "bad" : "info"}>{status.text}</Notice> : null}

      <Panel data-tour="plan-current" aria-label="Your plan">
        <div className="plx-planhero">
          <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
            <span className="plx-eyebrow">Your plan</span>
            <div className="plx-planhero__name">
              <h3>{current.name}</h3>
              <Badge tone={state.plan === PLAN.FREE ? "neutral" : state.pastDue ? "danger" : "success"} dot>{state.pastDue ? "Payment needed" : state.basis === "TRIAL" ? "Free trial" : state.plan === PLAN.FREE ? "Free" : "Active"}</Badge>
            </div>
            <p className="plx-body" style={{ maxWidth: 560 }}>{planStatusLine(state)}</p>
            {cardLine ? <p className="plx-small" style={{ margin: 0, display: "flex", gap: 8, alignItems: "center" }}><CreditCard size={16} aria-hidden /> {cardLine}</p> : null}
          </div>
          <div className="plx-planhero__act">
            {state.oneTime && state.plan !== PLAN.FREE ? (
              <Button loading={busy === `once-${state.plan}`} onClick={() => checkout({ kind: "subscription", plan: state.plan as PaidPlanId, interval: state.oneTimeInterval ?? "monthly", oneTime: true }, `once-${state.plan}`)}>Pay again to keep {planName(state.plan)}</Button>
            ) : state.paying ? (
              <Button loading={busy === "portal"} onClick={portal}>{state.pastDue ? "Update my card" : "Manage payment & invoices"}</Button>
            ) : nextPlan ? (
              <ButtonLink href="#plans" rightIcon={<ArrowRight size={18} aria-hidden />}>{state.plan === PLAN.FREE ? "Upgrade my plan" : "See plans"}</ButtonLink>
            ) : null}
            {state.paying && nextPlan ? <ButtonLink href="#plans" variant="ghost" size="sm">See bigger plans</ButtonLink> : null}
          </div>
        </div>
        <div className="plx-meters" data-tour="plan-usage" aria-label="What you're using">
          <UsageMeter label="Live websites" meter={siteMeter} hint={siteMeter.tone === "full" ? "All used. Upgrade to put more sites live." : siteMeter.tone === "near" ? "Nearly all used." : undefined} />
          <UsageMeter label="AI credits" meter={creditsMeter} hint={credits.low || credits.negative ? "Running low. Top up below." : `Refill in ${credits.resetsInDays} day${credits.resetsInDays === 1 ? "" : "s"}`} />
          <UsageMeter label="Products" meter={productMeter} hint={features.maxCommerceProducts === 0 ? "Selling products comes with Starter." : productMeter.tone !== "ok" ? "Nearly full." : undefined} />
          <UsageMeter label="Teammates" meter={seatMeter} hint={features.teamSeats === 0 ? "Inviting people comes with Starter." : seatMeter.tone === "full" ? "All seats used." : undefined} />
        </div>
      </Panel>


      {picking ? (() => {
        const row = pricing?.plans[picking];
        const hasYear = !!row?.yearlyLabel;
        const interval = hasYear ? pickInterval : "monthly";
        const price = interval === "yearly" ? row?.yearlyLabel : row?.monthlyLabel;
        const per = interval === "yearly" ? "a year" : "a month";
        const free = row?.yearlyMonthsFree;
        const once = payOnceOffered && pickRenew === "once";
        const verb = state.plan === PLAN.FREE ? "Choose" : "Switch to";
        return (
          <Modal
            open
            onClose={() => (busy ? undefined : setPicking(null))}
            title={`${verb} ${planName(picking)}`}
            description="Pick how you'd like to pay."
            width={520}
            footer={
              <>
                <Button variant="ghost" disabled={busy !== null} onClick={() => setPicking(null)}>Cancel</Button>
                <Button
                  loading={busy === `pick-${picking}`}
                  rightIcon={<ArrowRight size={18} aria-hidden />}
                  onClick={async () => {
                    await checkout({ kind: "subscription", plan: picking, interval, ...(once ? { oneTime: true } : {}) }, `pick-${picking}`);
                    setPicking(null);
                  }}
                >
                  Continue to payment
                </Button>
              </>
            }
          >
            <div className="plx-sppay">
              {hasYear ? (
                <SegmentedControl
                  label="How often you pay"
                  value={interval}
                  onChange={setPickInterval}
                  options={[
                    { value: "monthly", label: "Monthly" },
                    { value: "yearly", label: free ? `Yearly · ${free} months free` : "Yearly" },
                  ]}
                />
              ) : null}
              <div className="plx-sppay__price">
                {price ?? ""} <small>{per}</small>
              </div>
              <div role="radiogroup" aria-label="Renewal" className="plx-sppay__opts">
                <button type="button" role="radio" aria-checked={!once} className="plx-sppay__opt" onClick={() => setPickRenew("auto")}>
                  <b>Renews automatically</b>
                  <span>We charge your card each {interval === "yearly" ? "year" : "month"}. Cancel any time.</span>
                </button>
                {payOnceOffered ? (
                  <button type="button" role="radio" aria-checked={once} className="plx-sppay__opt" onClick={() => setPickRenew("once")}>
                    <b>Pay once</b>
                    <span>Pay for one {interval === "yearly" ? "year" : "month"} by bank transfer or card. It won&apos;t renew, and we&apos;ll remind you a week before it ends.</span>
                  </button>
                ) : null}
              </div>
            </div>
          </Modal>
        );
      })() : null}

      <Modal open={!!secret} onClose={() => setSecret(null)} title="Pay securely" width={600}>
        {secret ? (
          <div className="plx-checkout">
            <EmbeddedCheckoutProvider stripe={getStripePromise()} options={{ clientSecret: secret }}>
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          </div>
        ) : null}
      </Modal>
    </SettingsPageShell>
  );
}
