"use client";

import { createContext, useContext, useTransition } from "react";
import { useRouter } from "next/navigation";

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

function SkeletonCard() {
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

/** Wraps the results: shows placeholder cards while a new filter is loading. */
export function MarketplaceResults({ children }: { children: React.ReactNode }) {
  const b = useMarketplaceBrowse();
  if (!b?.pending) return <>{children}</>;
  return (
    <div role="status" aria-label="Loading templates" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-9 w-full">
      {Array.from({ length: 6 }, (_, i) => <SkeletonCard key={i} />)}
    </div>
  );
}
