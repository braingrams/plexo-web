"use client";

import { useEffect, useState } from "react";
import type { PricingView } from "@/lib/billing/pricing";

// The prices this person sees, in their own currency (GET /api/billing/pricing — worked out
// from where they are, or the currency saved on their account). One request per page load,
// however many components ask. Also works signed out (the register page).

let shared: Promise<PricingView | null> | null = null;

function fetchPricing(): Promise<PricingView | null> {
  return fetch("/api/billing/pricing", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<PricingView>) : null))
    .catch(() => null);
}

export function usePricing(): {
  pricing: PricingView | null;
} {
  const [pricing, setPricing] = useState<PricingView | null>(null);
  useEffect(() => {
    shared ??= fetchPricing();
    let live = true;
    void shared.then((p) => live && setPricing(p));
    // The owner just told us their country (CountryPrompt): prices change with it.
    const refresh = () => {
      shared = fetchPricing();
      void shared.then((p) => live && setPricing(p));
    };
    window.addEventListener("plexo:country-saved", refresh);
    return () => {
      live = false;
      window.removeEventListener("plexo:country-saved", refresh);
    };
  }, []);

  return { pricing };
}

/** "Prices in Naira" — the currency's everyday name. */
export function currencyName(currency: string): string {
  switch (currency) {
    case "NGN":
      return "Naira";
    case "GHS":
      return "Cedis";
    case "KES":
      return "Kenyan shillings";
    case "ZAR":
      return "Rand";
    default:
      return "US dollars";
  }
}
