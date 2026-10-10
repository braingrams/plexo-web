"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// One quiet line above every dashboard page about where the account's plan stands: a
// trial's days left, a card that needs updating, or — after a downgrade — that nothing was
// deleted and one click brings it all back. The site and app editors show their own,
// site-specific notice instead (SitePlanNotice), so this stays out of their way.

export type PlanBannerState =
  | { kind: "trial"; plan: "PRO" | "ULTRA"; daysLeft: number }
  | { kind: "grant"; plan: "PRO" | "ULTRA"; daysLeft: number }
  | { kind: "past_due"; plan: "PRO" | "ULTRA" }
  | { kind: "downgraded"; previousPlan: "PRO" | "ULTRA"; since: string; reason: string | null };

const NAME = { PRO: "Pro", ULTRA: "Ultra" } as const;

function stateKey(state: PlanBannerState): string {
  if (state.kind === "downgraded") return `downgraded:${state.since}`;
  if (state.kind === "past_due") return "past_due";
  // Trials re-show as the end gets close, even after being closed earlier.
  return `${state.kind}:${state.daysLeft <= 3 ? "ending" : "running"}`;
}

const DISMISS_KEY = "plexo:plan-banner-dismissed";

export function PlanBanner({ state }: { state: PlanBannerState }) {
  const pathname = usePathname() ?? "";
  const [dismissed, setDismissed] = useState(true);
  const key = stateKey(state);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === key);
    } catch {
      setDismissed(false);
    }
  }, [key]);

  const inEditor = /^\/dashboard\/(templates\/[^/]+$|apps\/[^/]+)/.test(pathname);
  const onBillingPage = pathname.startsWith("/dashboard/settings/subscription");
  // A card problem is never hidden: it's the one thing that will cost the owner their plan.
  if (inEditor || onBillingPage || (dismissed && state.kind !== "past_due")) return null;

  const copy = describe(state);
  const close = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, key);
    } catch {
      // hidden for this visit only
    }
    setDismissed(true);
  };

  return (
    <div role="status" style={{ ...bar, borderColor: copy.tone.border, background: copy.tone.background }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#f0f2ff" }}>{copy.headline}</div>
        <div style={{ fontSize: 12, color: "rgba(240,242,255,0.6)", marginTop: 2 }}>{copy.detail}</div>
      </div>
      <Link href={copy.href} style={button}>
        {copy.cta} →
      </Link>
      {state.kind !== "past_due" && (
        <button type="button" onClick={close} aria-label="Dismiss" style={closeButton}>
          ×
        </button>
      )}
    </div>
  );
}

function describe(state: PlanBannerState): { headline: string; detail: string; cta: string; href: string; tone: { border: string; background: string } } {
  const brand = { border: "rgba(var(--brand-rgb),0.35)", background: "rgba(var(--brand-rgb),0.07)" };
  const amber = { border: "rgba(245,183,74,0.45)", background: "rgba(245,183,74,0.08)" };
  if (state.kind === "trial" || state.kind === "grant") {
    const name = NAME[state.plan];
    const left = state.daysLeft <= 0 ? "ends today" : `${state.daysLeft} day${state.daysLeft === 1 ? "" : "s"} left`;
    return {
      headline: state.kind === "trial" ? `${name} trial · ${left}` : `${name} access · ${left}`,
      detail: "Everything is unlocked. Choose a plan to keep it — otherwise one site stays live with its homepage, and nothing is deleted.",
      cta: `Keep ${name}`,
      href: `/dashboard/settings/subscription?upgrade=${state.plan}`,
      tone: state.daysLeft <= 3 ? amber : brand,
    };
  }
  if (state.kind === "past_due") {
    return {
      headline: `We couldn't take your last ${NAME[state.plan]} payment`,
      detail: "Your plan is still on while we retry. Update your card so nothing changes.",
      cta: "Update payment",
      href: "/dashboard/settings/subscription",
      tone: amber,
    };
  }
  const name = NAME[state.previousPlan];
  return {
    headline: state.reason === "TRIAL_ENDED" ? `Your ${name} trial has ended` : `Your ${name} plan has ended`,
    detail: "You're on Free: one site is live with its homepage. Your other pages, sites and custom domains are saved — not deleted.",
    cta: "Bring everything back",
    href: `/dashboard/settings/subscription?upgrade=${state.previousPlan}`,
    tone: amber,
  };
}

const bar: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  flexWrap: "wrap",
  padding: "12px 16px",
  margin: "0 0 20px",
  borderRadius: 12,
  border: "1px solid",
};

const button: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "8px 14px",
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 700,
  textDecoration: "none",
  background: "rgba(var(--brand-rgb),0.18)",
  color: "var(--brand)",
  whiteSpace: "nowrap",
};

const closeButton: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "rgba(240,242,255,0.45)",
  fontSize: 18,
  lineHeight: 1,
  cursor: "pointer",
  padding: "0 4px",
};
