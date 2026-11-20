"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { startTrial, useTrialAvailable } from "./trial";
import { PLAN, PLAN_LABELS, type PaidPlanId, type TrialPlanId } from "@/lib/plan/plans";
import { markGateShown, planGateForMessage, safeReturnTo, upgradeHref } from "@/lib/plan/planGate";

/**
 * The one way the dashboard says "this needs a bigger plan": what's needed in plain words,
 * then a one-click way to get it that brings the owner straight back to where they were.
 * While the free trial is unused the main button starts it (no card); otherwise it goes to
 * checkout. Replaces bare error text wherever a plan limit stops something.
 */
export function UpgradePrompt({
  message,
  requiredPlan = PLAN.STARTER,
  returnTo,
  onBeforeUpgrade,
  extraActions,
  tone = "warning",
}: {
  message: string;
  requiredPlan?: PaidPlanId;
  /** Where to come back to after paying or starting the trial. Defaults to this page. */
  returnTo?: string;
  /** Called just before leaving, e.g. to remember a publish that is waiting. */
  onBeforeUpgrade?: () => void;
  extraActions?: ReactNode;
  tone?: "warning" | "info";
}) {
  const trial = useTrialAvailable();
  useEffect(() => markGateShown(message), [message]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const back = safeReturnTo(returnTo ?? (typeof window === "undefined" ? undefined : window.location.pathname + window.location.search));
  const planName = PLAN_LABELS[requiredPlan];
  const trialPlan: TrialPlanId | null = requiredPlan === PLAN.STARTER ? PLAN.STARTER : requiredPlan === PLAN.PRO ? PLAN.PRO : null;
  const canTrial = trial.available && trialPlan !== null;

  function tryFree(): void {
    if (!trialPlan) return;
    setBusy(true);
    setError(null);
    onBeforeUpgrade?.();
    void startTrial(trialPlan, back).catch((err) => {
      setError(err instanceof Error ? err.message : "Couldn't start your trial.");
      setBusy(false);
    });
  }

  function upgrade(): void {
    setBusy(true);
    onBeforeUpgrade?.();
    window.location.href = upgradeHref(requiredPlan, back);
  }

  const accent = tone === "warning" ? "var(--plx-warning, rgb(245 183 74))" : "var(--plx-brand, var(--brand))";
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.65rem",
        padding: "0.8rem 0.9rem",
        borderRadius: 10,
        border: `1px solid color-mix(in srgb, ${accent} 35%, transparent)`,
        background: `color-mix(in srgb, ${accent} 9%, transparent)`,
        fontSize: "0.8rem",
        lineHeight: 1.5,
        color: "var(--ed-text, inherit)",
      }}
    >
      <span>{message}</span>
      {canTrial && <span style={{ opacity: 0.8 }}>Try {planName} free for {trial.trialDays} days first. No card needed.</span>}
      {error && <span style={{ color: "var(--ed-danger, var(--plx-danger, #f87171))" }}>{error}</span>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
        {canTrial ? (
          <>
            <button type="button" onClick={tryFree} disabled={busy} className="btn-primary" style={button}>
              {busy ? "One moment…" : `Try ${planName} free for ${trial.trialDays} days`}
            </button>
            <button type="button" onClick={upgrade} disabled={busy} className="btn-secondary" style={button}>Upgrade to {planName}</button>
          </>
        ) : (
          <button type="button" onClick={upgrade} disabled={busy} className="btn-primary" style={button}>
            {busy ? "One moment…" : `Upgrade to ${planName}`}
          </button>
        )}
        {extraActions}
      </div>
    </div>
  );
}

const button: CSSProperties = { padding: "0.45rem 0.9rem", fontSize: "0.78rem" };

/**
 * Where a screen shows its error text: if that text came from a plan limit it becomes the
 * upgrade prompt, otherwise it is shown as the screen always showed it (`children`).
 */
export function GateOrError({ error, children, returnTo }: { error: string | null | undefined; children: ReactNode; returnTo?: string }) {
  const gate = planGateForMessage(error);
  if (!error) return null;
  if (!gate) return <>{children}</>;
  // Every course slot in use: one extra slot can also be bought on its own, without changing plan.
  const back = safeReturnTo(returnTo ?? (typeof window === "undefined" ? undefined : window.location.pathname + window.location.search));
  const extra = gate.code === "PLAN_FUNNEL_SLOTS" && gate.canBuySlot ? (
    <a href={`/dashboard/settings/subscription?addon=funnel_slot&returnTo=${encodeURIComponent(back)}`} className="btn-secondary" style={button}>Buy one extra slot</a>
  ) : null;
  return <UpgradePrompt message={gate.message} requiredPlan={gate.requiredPlan} returnTo={returnTo} extraActions={extra} />;
}
