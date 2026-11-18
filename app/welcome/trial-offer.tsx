"use client";

import { trackEvent } from "@/lib/analytics";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { AuthShell } from "@/app/auth/_kit/AuthShell";
import { Alert, Button, PageHead } from "@/app/auth/_kit/ui";
import { getTierFeatures } from "@/lib/subscription";
import { PLAN_LABELS } from "@/lib/plan/plans";
import { usePricing } from "@/app/dashboard/_components/usePricing";

type TrialPlan = "STARTER" | "PRO";

// What each trial plan is for, from the plan table itself (lib/subscription.ts). Prices come
// from the price list in the visitor's own currency (usePricing), never written here.
const PLANS: Record<TrialPlan, { name: string; tagline: string; perks: string[] }> = {
  STARTER: {
    name: PLAN_LABELS.STARTER,
    tagline: "One full website for your business.",
    perks: ["Every page live, plus a blog", `A store with ${getTierFeatures("STARTER").maxCommerceProducts.toLocaleString("en-US")} products`, "Your own domain"],
  },
  PRO: {
    name: PLAN_LABELS.PRO,
    tagline: "Several websites, room to grow.",
    perks: [`Up to ${getTierFeatures("PRO").maxPublishedSites} websites live`, `${getTierFeatures("PRO").includedFunnelSlots} funnels and a store`, "No “Hosted with Plexo” badge"],
  },
};

export function TrialOffer({ firstName, highlighted, trialDays }: { firstName: string | null; highlighted: TrialPlan; trialDays: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<TrialPlan | "free" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { pricing } = usePricing();

  async function choose(choice: TrialPlan | "free"): Promise<void> {
    setBusy(choice);
    setError(null);
    try {
      const res = await fetch("/api/billing/trial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(choice === "free" ? { dismiss: true } : { plan: choice }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
      // Only after the server confirms the trial. Ultra isn't in the analytics plan list yet, so it isn't sent.
      if (choice === "PRO") trackEvent({ event: "trial_start", plan_name: "pro", trial_days: trialDays, source_page: "welcome" });
      router.push(choice === "free" ? "/dashboard" : "/dashboard?trial=started");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setBusy(null);
    }
  }

  return (
    <AuthShell layout="center" xl>
      <div className="ax-center-text">
        <PageHead title={`${firstName ? `${firstName}, try` : "Try"} Plexo free for ${trialDays} days`}>No card needed. Cancel any time.</PageHead>

        <div className="ax-plans">
          {(["STARTER", "PRO"] as const).map((key) => {
            const plan = PLANS[key];
            const isHighlighted = key === highlighted;
            const price = pricing ? pricing.plans[key] : null;
            return (
              <section key={key} className={`ax-plan${isHighlighted ? " ax-plan-hl" : ""}`} aria-labelledby={`plan-${key}`}>
                <div>
                  <div className="ax-plan-top">
                    <h2 id={`plan-${key}`} className="ax-plan-name">{plan.name}</h2>
                    {isHighlighted ? <span className="ax-chip">Most popular</span> : null}
                  </div>
                  <p className="ax-plan-tag">{plan.tagline}</p>
                  {price ? <p className="ax-plan-price" style={{ marginTop: 10 }}>Then <strong>{price.isFromPrice ? "from " : ""}{price.monthlyLabel}</strong>/month</p> : null}
                </div>
                <ul className="ax-plan-list">
                  {plan.perks.map((text) => (
                    <li key={text}><span className="ax-check-dot"><Check size={12} strokeWidth={3} aria-hidden="true" /></span>{text}</li>
                  ))}
                </ul>
                <Button type="button" variant={isHighlighted ? "primary" : "secondary"} loading={busy === key} disabled={busy !== null} onClick={() => void choose(key)}>
                  {busy === key ? "Starting…" : "Start free trial"}
                </Button>
              </section>
            );
          })}
        </div>

        {error ? <div style={{ marginTop: 20, textAlign: "left" }}><Alert tone="error">{error}</Alert></div> : null}

        <p className="ax-foot">
          <button type="button" className="ax-link" disabled={busy !== null} onClick={() => void choose("free")}>
            {busy === "free" ? "One moment…" : "Continue with the Free plan"}
          </button>
        </p>
      </div>
    </AuthShell>
  );
}
