"use client";

import { createContext, useContext, useTransition } from "react";
import { useRouter } from "next/navigation";
import { OptimisticLoader } from "@/app/dashboard/_v3/ui/OptimisticLoader";

/**
 * The filters and the results live in different parts of the (server-rendered) page, so this shares one "loading" flag
 * between them: the moment someone picks a filter, the results area turns into placeholder cards until the new ones arrive,
 * instead of sitting unchanged and looking like the click did nothing.
 */
const Ctx = createContext<{ pending: boolean; go: (url: string) => void } | null>(null);

export function MarketplaceBrowse({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <Ctx.Provider value={{ pending, go: (url) => startTransition(() => router.push(url)) }}>{children}</Ctx.Provider>;
}

/** Null outside the provider (the embedded marketplace modal drives its own loading). */
export const useMarketplaceBrowse = () => useContext(Ctx);

export function SkeletonCard() {
  return (
    <div className="flex flex-col animate-pulse">
      <div className="aspect-[4/3] rounded-2xl bg-[var(--surface)] border border-[var(--surface-border)]" />
      <div className="pt-3.5 px-1 space-y-2">
        <div className="h-4 w-3/4 rounded bg-[var(--surface)]" />
        <div className="h-3 w-1/2 rounded bg-[var(--surface)]" />
      </div>
    </div>
  );
}

/** Wraps the results: shows engaging optimistic loader while a new filter is loading. */
export function MarketplaceResults({ children }: { children: React.ReactNode }) {
  const b = useMarketplaceBrowse();
  if (!b?.pending) return <>{children}</>;
  return (
    <div role="status" aria-label="Loading templates" className="w-full flex items-center justify-center py-16">
      <OptimisticLoader steps={["Searching templates in marketplace…", "Matching design recipes and styles…", "Preparing live template cards…"]} subtitle="Browsing marketplace catalog" />
    </div>
  );
}

/** The placeholder grid, for places that load their own results (the dashboard's marketplace modal). */
export function MarketplaceSkeletonGrid() {
  return (
    <div role="status" aria-label="Loading templates" className="w-full flex items-center justify-center py-16">
      <OptimisticLoader steps={["Loading templates from catalog…", "Matching design recipes and styles…", "Preparing live template cards…"]} subtitle="Browsing marketplace catalog" />
    </div>
  );
}
