"use client";

import { useEffect, useState } from "react";

export type TopupPackInfo = { pack: "SMALL" | "MEDIUM" | "LARGE"; credits: number; price: string };

/** The credit packs with their price in the person's own currency and the credits each adds
 *  (flat rate from the price list — lib/billing/pricing.ts). Empty until loaded. */
export function useTopupPacks(): Record<string, TopupPackInfo> {
  const [packs, setPacks] = useState<Record<string, TopupPackInfo>>({});
  useEffect(() => {
    let cancelled = false;
    fetch("/api/billing/topup-packs")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !Array.isArray(d?.packs)) return;
        setPacks(Object.fromEntries((d.packs as TopupPackInfo[]).map((p) => [p.pack, p])));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return packs;
}

export function packLabel(info: TopupPackInfo | undefined): string {
  return info ? `${info.credits.toLocaleString("en-US")} credits` : "Credits";
}
