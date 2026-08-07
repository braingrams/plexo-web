"use client";

import { useRouter, usePathname } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { Search, X, Sparkles, Layout, Mail, Layers, Filter } from "lucide-react";

export function MarketplaceFilters({
  categories,
  categoryCounts,
  totalCount,
  current,
}: {
  categories: string[];
  categoryCounts?: Record<string, number>;
  totalCount?: number;
  current: { category?: string; kind?: string; free?: string; q?: string; sort: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const [searchValue, setSearchValue] = useState(current.q ?? "");

  const updateFilters = useCallback(
    (newParams: Record<string, string | undefined>) => {
      const params = new URLSearchParams();

      const merged = {
        category: current.category,
        kind: current.kind,
        free: current.free,
        q: searchValue,
        sort: current.sort,
        ...newParams,
      };

      Object.entries(merged).forEach(([key, val]) => {
        if (val !== undefined && val !== "" && val !== "all") {
          params.set(key, val);
        }
      });

      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`);
      });
    },
    [current, pathname, router, searchValue]
  );

  const hasActiveFilters = Boolean(
    current.category || current.kind || current.free || current.q
  );

  const clearAllFilters = () => {
    setSearchValue("");
    startTransition(() => {
      router.push(pathname);
    });
  };

  return (
    <div className="flex flex-col gap-5 w-full">
      {/* Horizontal Category Navigation Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
        <button
          type="button"
          onClick={() => updateFilters({ category: undefined })}
          className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-all duration-200 ${
            !current.category
              ? "bg-[var(--brand)] text-white shadow-lg shadow-[var(--brand-glow)] scale-[1.02]"
              : "bg-[var(--surface)] text-[var(--text-muted)] border border-[var(--surface-border)] hover:border-[var(--brand-glow)] hover:text-[var(--text-main)]"
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>All Templates</span>
          {totalCount !== undefined && (
            <span className={`ml-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
              !current.category ? "bg-white/20 text-white" : "bg-[var(--surface-border)] text-[var(--text-muted)]"
            }`}>
              {totalCount}
            </span>
          )}
        </button>

        {categories.map((cat) => {
          const isActive = current.category === cat;
          const count = categoryCounts ? categoryCounts[cat] : undefined;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => updateFilters({ category: isActive ? undefined : cat })}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium whitespace-nowrap transition-all duration-200 ${
                isActive
                  ? "bg-[var(--brand)] text-white shadow-lg shadow-[var(--brand-glow)] scale-[1.02]"
                  : "bg-[var(--surface)] text-[var(--text-muted)] border border-[var(--surface-border)] hover:border-[var(--brand-glow)] hover:text-[var(--text-main)]"
              }`}
            >
              <span>{cat}</span>
              {count !== undefined && (
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  isActive ? "bg-white/20 text-white" : "bg-[var(--surface-border)] text-[var(--text-muted)]"
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Main Controls Panel */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 p-4 rounded-2xl bg-[var(--surface)] border border-[var(--surface-border)] backdrop-blur-xl shadow-xl">
        {/* Search Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            updateFilters({ q: searchValue });
          }}
          className="relative flex-1"
        >
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] pointer-events-none" />
          <input
            type="text"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder="Search templates by name, keyword or design tag..."
            className="w-full pl-10 pr-9 py-2.5 rounded-xl bg-[var(--bg-1)] border border-[var(--surface-border)] text-sm text-[var(--text-main)] placeholder-[var(--text-faint)] outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-glow)] transition-all"
          />
          {searchValue ? (
            <button
              type="button"
              onClick={() => {
                setSearchValue("");
                updateFilters({ q: undefined });
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : (
            <kbd className="absolute right-3.5 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono text-[var(--text-faint)] bg-[var(--surface-border)] border border-[var(--surface-border)]">
              /
            </kbd>
          )}
        </form>

        {/* Filter Controls & Segmented Toggles */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Kind Toggle (All / Landing / Email) */}
          <div className="flex items-center p-1 rounded-xl bg-[var(--bg-1)] border border-[var(--surface-border)] text-xs">
            <button
              type="button"
              onClick={() => updateFilters({ kind: undefined })}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                !current.kind
                  ? "bg-[var(--brand)] text-white shadow-sm"
                  : "text-[var(--text-muted)] hover:text-[var(--text-main)]"
              }`}
            >
              All Types
            </button>
            <button
              type="button"
              onClick={() => updateFilters({ kind: "LANDING_PAGE" })}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all ${
                current.kind === "LANDING_PAGE"
                  ? "bg-[var(--brand)] text-white shadow-sm"
                  : "text-[var(--text-muted)] hover:text-[var(--text-main)]"
              }`}
            >
              <Layout className="w-3 h-3" />
              Landing
            </button>
            <button
              type="button"
              onClick={() => updateFilters({ kind: "EMAIL" })}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all ${
                current.kind === "EMAIL"
                  ? "bg-[var(--brand)] text-white shadow-sm"
                  : "text-[var(--text-muted)] hover:text-[var(--text-main)]"
              }`}
            >
              <Mail className="w-3 h-3" />
              Email
            </button>
          </div>

          {/* Pricing Select */}
          <select
            value={current.free ?? ""}
            onChange={(e) => updateFilters({ free: e.target.value || undefined })}
            className="rounded-xl border border-[var(--surface-border)] bg-[var(--bg-1)] pl-3.5 pr-8 py-2 text-xs font-medium text-[var(--text-main)] outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-glow)]"
          >
            <option value="">All Prices</option>
            <option value="true">Free Only</option>
            <option value="false">Paid Only</option>
          </select>

          {/* Sort Select */}
          <select
            value={current.sort}
            onChange={(e) => updateFilters({ sort: e.target.value })}
            className="rounded-xl border border-[var(--surface-border)] bg-[var(--bg-1)] pl-3.5 pr-8 py-2 text-xs font-medium text-[var(--text-main)] outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-glow)]"
          >
            <option value="popular">Most Popular</option>
            <option value="latest">Latest Released</option>
          </select>

          {/* Clear Filters CTA */}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearAllFilters}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--brand-glow)] bg-[var(--brand-subtle)] text-xs font-medium text-[var(--brand)] hover:bg-[var(--brand-glow)] transition-all"
            >
              <X className="w-3.5 h-3.5" />
              Reset Filters
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
