"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Archive, CalendarClock, Clock, CreditCard } from "lucide-react";
import { DashboardNotice, type NoticeAction } from "./DashboardNotice";
import { startTrial } from "./trial";

// One quiet notice above dashboard pages about where the account's plan stands: a trial's
// days left, a card that needs updating, or — after a downgrade — that nothing was deleted
// and one click brings it all back. The site and app editors show their own site-specific
// notice instead (SitePlanNotice), so this stays out of their way.

export type PlanBannerState =
  | { kind: "trial"; plan: "PRO" | "ULTRA"; daysLeft: number; trialDays: number }
  | { kind: "grant"; plan: "PRO" | "ULTRA"; daysLeft: number }
  | { kind: "past_due"; plan: "PRO" | "ULTRA" }
  | { kind: "downgraded"; previousPlan: "PRO" | "ULTRA"; since: string; reason: string | null; trialAvailable: boolean };

const NAME = { PRO: "Pro", ULTRA: "Ultra" } as const;

function stateKey(state: PlanBannerState): string {
  if (state.kind === "downgraded") return `downgraded:${state.since}`;
  if (state.kind === "past_due") return "past_due";
  // Re-shows once the end is close, even after being closed earlier.
  return `${state.kind}:${state.daysLeft <= 3 ? "ending" : "running"}`;
}

const DISMISS_KEY = "plexo:plan-banner-dismissed";

export function PlanBanner({ state }: { state: PlanBannerState }) {
  const pathname = usePathname() ?? "";
  const [dismissed, setDismissed] = useState(true);
  const [busy, setBusy] = useState(false);
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
  // A failing card is never hidden: it's the one thing that will cost the owner their plan.
  if (inEditor || onBillingPage || (dismissed && state.kind !== "past_due")) return null;

  const dismiss =
    state.kind === "past_due"
      ? undefined
      : () => {
          try {
            window.localStorage.setItem(DISMISS_KEY, key);
          } catch {
            // hidden for this visit only
          }
          setDismissed(true);
        };

  if (state.kind === "trial" || state.kind === "grant") {
    const name = NAME[state.plan];
    const left = state.daysLeft <= 0 ? "ends today" : `${state.daysLeft} day${state.daysLeft === 1 ? "" : "s"} left`;
    return (
      <DashboardNotice
        tone={state.daysLeft <= 3 ? "warning" : "brand"}
        icon={state.kind === "trial" ? Clock : CalendarClock}
        title={state.kind === "trial" ? `${name} trial · ${left}` : `${name} access · ${left}`}
        detail="Everything's unlocked. Keep it by choosing a plan — nothing is ever deleted either way."
        progress={state.kind === "trial" ? 1 - state.daysLeft / state.trialDays : undefined}
        actions={[{ label: `Keep ${name}`, href: `/dashboard/settings/subscription?upgrade=${state.plan}` }]}
        onDismiss={dismiss}
      />
    );
  }

  if (state.kind === "past_due") {
    return (
      <DashboardNotice
        tone="warning"
        icon={CreditCard}
        title={`We couldn't take your last ${NAME[state.plan]} payment`}
        detail="Your plan stays on while we retry. Update your card so nothing changes."
        actions={[{ label: "Update payment", href: "/dashboard/settings/subscription" }]}
      />
    );
  }

  const name = NAME[state.previousPlan];
  const actions: NoticeAction[] = state.trialAvailable
    ? [
        {
          label: `Try ${name} free for 14 days`,
          busy,
          onClick: () => {
            setBusy(true);
            void startTrial(state.previousPlan).catch(() => setBusy(false));
          },
        },
        { label: "See plans", href: "/dashboard/settings/subscription", variant: "quiet" },
      ]
    : [{ label: "Bring everything back", href: `/dashboard/settings/subscription?upgrade=${state.previousPlan}` }];
  return (
    <DashboardNotice
      tone="warning"
      icon={Archive}
      title={state.reason === "TRIAL_ENDED" ? `Your ${name} trial has ended` : `Your ${name} plan has ended`}
      detail="You're on Free with one site live. Your other pages, sites and domains are saved, not deleted."
      actions={actions}
      onDismiss={dismiss}
    />
  );
}
