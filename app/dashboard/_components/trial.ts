import { TrialPlanId } from "@/lib/plan/plans";
"use client";

import { useEffect, useState } from "react";

// Shared by every "Try Starter/Pro free for 14 days" button: whether this account can still start
// its one trial, and starting it. One request per page load, however many buttons ask.

let availability: Promise<{ available: boolean; trialDays: number }> | null = null;

export function useTrialAvailable(): { available: boolean; trialDays: number } {
  const [state, setState] = useState({ available: false, trialDays: 14 });
  useEffect(() => {
    availability ??= fetch("/api/billing/trial", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { available: false, trialDays: 14 }))
      .catch(() => ({ available: false, trialDays: 14 }));
    let live = true;
    void availability.then((s) => live && setState(s));
    return () => {
      live = false;
    };
  }, []);
  return state;
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
