"use client";

import { useEffect, useState } from "react";
import { PLAN_LABELS } from "@/lib/plan/plans";
import { safeReturnTo, upgradeHref } from "@/lib/plan/planGate";
import { creditUpgradeLine, type CreditUpgradeOffer } from "@/lib/credits/upgradeOffer";

/**
 * The two ways out of "no AI credits" besides topping up, shown the same everywhere SOL can
 * run dry: use your own AI key (no Plexo credits needed), or move to the plan that grants
 * more credits every month. Both bring the owner straight back to where they were. (A free
 * trial adds no AI credits, so the upgrade is a plain upgrade, never a trial.)
 */
export function useCreditUpgrade(): CreditUpgradeOffer | null {
  const [offer, setOffer] = useState<CreditUpgradeOffer | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/billing/credit-upgrade", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { offer?: CreditUpgradeOffer | null } | null) => live && setOffer(d?.offer ?? null))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return offer;
}

const link = { color: "inherit", fontSize: "0.8rem", fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 3 } as const;

export function OutOfCreditsOptions({ returnTo }: { returnTo?: string }) {
  const offer = useCreditUpgrade();
  const back = safeReturnTo(returnTo ?? (typeof window === "undefined" ? undefined : window.location.pathname + window.location.search));
  return (
    <div data-out-of-credits-options style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
      <a href={`/dashboard/settings/ai?returnTo=${encodeURIComponent(back)}`} style={link}>
        Use my own AI key →
      </a>
      {offer && (
        <a href={upgradeHref(offer.plan, back)} style={link}>
          Upgrade to {PLAN_LABELS[offer.plan]} for more credits →
          <span style={{ display: "block", fontWeight: 400, opacity: 0.75 }}>{creditUpgradeLine(offer, PLAN_LABELS[offer.plan])}</span>
        </a>
      )}
    </div>
  );
}
