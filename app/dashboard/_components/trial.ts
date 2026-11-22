"use client";
import { TrialPlanId, type PlanId } from "@/lib/plan/plans";

import { useEffect, useState } from "react";

// Shared by every "Try Starter/Pro free for 14 days" button: whether this account can still start
// its one trial, and starting it. One request per page load, however many buttons ask.

type Availability = { available: boolean; trialDays: number; plan?: PlanId; onTrial?: boolean };
let availability: Promise<Availability> | null = null;

export function useTrialAvailable(): { available: boolean; trialDays: number } {
  const { available, trialDays } = useMyPlan();
  return { available, trialDays };
}

/** The account's plan right now (null until known) plus the trial facts — one request per page load, shared. */
export function useMyPlan(): { plan: PlanId | null; onTrial: boolean; available: boolean; trialDays: number } {
  const [state, setState] = useState<Availability>({ available: false, trialDays: 14 });
  useEffect(() => {
    // Preview pages (app/v3-preview) have no account: they hand the screen a pretend one.
    const preview = (window as unknown as { __plxPreviewPlan?: Availability }).__plxPreviewPlan;
    if (preview) {
      setState(preview);
      return;
    }
    availability ??= fetch("/api/billing/trial", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { available: false, trialDays: 14 }))
      .catch(() => ({ available: false, trialDays: 14 }));
    let live = true;
    void availability.then((s) => live && setState(s));
    return () => {
      live = false;
    };
  }, []);
  return { plan: state.plan ?? null, onTrial: state.onTrial === true, available: state.available, trialDays: state.trialDays };
}

/** Starts the trial, then reloads `returnTo` (default: this page) so everything unlocked shows at once. */
export async function startTrial(plan: TrialPlanId, returnTo?: string): Promise<void> {
  const res = await fetch("/api/billing/trial", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Couldn't start your trial.");
  availability = null;
  window.location.href = returnTo ?? window.location.pathname + window.location.search;
}
