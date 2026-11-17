"use client";

import { useRouter, usePathname } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { useMarketplaceBrowse } from "./MarketplaceBrowse";
import { Search, X, Layout, Mail, Layers } from "lucide-react";
import { CustomSelect } from "@/app/_components/CustomSelect";

export function MarketplaceFilters({
  categories,
  totalCount,
  current,
  onFilterChange,
}: {
  categories: string[];
  categoryCounts?: Record<string, number>;
  totalCount?: number;
  current: { category?: string; kind?: string; free?: string; q?: string; sort: string };
  // When provided, filter changes are reported here instead of pushing a URL — for a
  // client-driven browser (e.g. the marketplace modal embedded in the Templates page)
  // that fetches its own data and isn't the standalone /dashboard/marketplace page. That page
  // page omits this and keeps the original router-push/URL-param behavior unchanged.
  onFilterChange?: (params: { category?: string; kind?: string; free?: string; q?: string; sort?: string }) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [ownPending, startTransition] = useTransition();
  const browse = useMarketplaceBrowse();
  const isPending = ownPending || !!browse?.pending;

  const [searchValue, setSearchValue] = useState(current.q ?? "");

  const updateFilters = useCallback(
    (newParams: Record<string, string | undefined>) => {
      const merged = {
        category: current.category,
        kind: current.kind,
        free: current.free,
        q: searchValue,
        sort: current.sort,
        ...newParams,
      };

      if (onFilterChange) {
        onFilterChange(merged);
        return;
      }

      const params = new URLSearchParams();
      Object.entries(merged).forEach(([key, val]) => {
        if (val !== undefined && val !== "" && val !== "all") {
          params.set(key, val);
        }
      });

      const url = `${pathname}?${params.toString()}`;
      if (browse) browse.go(url);
      else startTransition(() => router.push(url));
    },
    [current, pathname, router, searchValue, onFilterChange, browse]
  );

  const clearAllFilters = () => {
    setSearchValue("");
    if (onFilterChange) {
      onFilterChange({ category: undefined, kind: undefined, free: undefined, q: undefined, sort: current.sort });
      return;
    }
    if (browse) browse.go(pathname);
    else startTransition(() => router.push(pathname));
  };

  const seg = (on: boolean) =>
    `flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
      on ? "bg-[var(--brand)] text-white shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text-main)]"
    }`;
  const kindLabel = current.kind === "LANDING_PAGE" ? "Web pages" : current.kind === "EMAIL" ? "Emails" : null;
  const priceLabel = current.free === "true" ? "Free" : current.free === "false" ? "Paid" : null;
  const chips: Array<{ label: string; clear: () => void }> = [
    ...(current.q ? [{ label: `“${current.q}”`, clear: () => { setSearchValue(""); updateFilters({ q: undefined }); } }] : []),
    ...(kindLabel ? [{ label: kindLabel, clear: () => updateFilters({ kind: undefined }) }] : []),
    ...(priceLabel ? [{ label: priceLabel, clear: () => updateFilters({ free: undefined }) }] : []),
    ...(current.category ? [{ label: current.category, clear: () => updateFilters({ category: undefined }) }] : []),
  ];

  return (
    <div className={`flex flex-col gap-3 w-full transition-opacity ${isPending ? "opacity-70" : ""}`}>
      {/* Row 1: say what you're looking for */}
      <div className="flex flex-col sm:flex-row gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            updateFilters({ q: searchValue });
          }}
          className="relative flex-1"
        >
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] pointer-events-none" />
          <input
            type="search"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder="Search by name or what it's for, like “restaurant” or “portfolio”"
            aria-label="Search templates"
            className="w-full pl-11 pr-4 py-3 rounded-xl bg-[var(--surface)] border border-[var(--surface-border)] text-sm text-[var(--text-main)] placeholder-[var(--text-faint)] outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-glow)] transition-all"
          />
        </form>
        <div className="sm:w-52">
          <CustomSelect
            value={current.sort}
            onChange={(value) => updateFilters({ sort: value })}
            options={[
              { label: "Newest first", value: "latest" },
              { label: "Most used", value: "popular" },
            ]}
          />
        </div>
      </div>

      {/* Row 2: narrow it down — everything on one wrapping row, nothing scrolls sideways */}
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Type" className="flex items-center p-1 rounded-xl bg-[var(--surface)] border border-[var(--surface-border)]">
          <button type="button" aria-pressed={!current.kind} onClick={() => updateFilters({ kind: undefined })} className={seg(!current.kind)}>
            <Layers className="w-3.5 h-3.5" /> All
          </button>
          <button type="button" aria-pressed={current.kind === "LANDING_PAGE"} onClick={() => updateFilters({ kind: "LANDING_PAGE" })} className={seg(current.kind === "LANDING_PAGE")}>
            <Layout className="w-3.5 h-3.5" /> Web pages
          </button>
          <button type="button" aria-pressed={current.kind === "EMAIL"} onClick={() => updateFilters({ kind: "EMAIL" })} className={seg(current.kind === "EMAIL")}>
            <Mail className="w-3.5 h-3.5" /> Emails
          </button>
        </div>

        <div role="group" aria-label="Price" className="flex items-center p-1 rounded-xl bg-[var(--surface)] border border-[var(--surface-border)]">
          {([["", "Any price"], ["true", "Free"], ["false", "Paid"]] as const).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={(current.free ?? "") === value} onClick={() => updateFilters({ free: value || undefined })} className={seg((current.free ?? "") === value)}>
              {label}
            </button>
          ))}
        </div>

        {categories.length > 0 && (
          <div className="min-w-[210px]">
            <CustomSelect
              value={current.category ?? ""}
              onChange={(value) => updateFilters({ category: value || undefined })}
              options={[
                { label: "All industries", value: "" },
                ...[...categories].sort((a, b) => a.localeCompare(b)).map((c) => ({ label: c, value: c })),
              ]}
            />
          </div>
        )}

        {totalCount !== undefined && (
          <span className="ml-auto text-xs text-[var(--text-muted)]" aria-live="polite">
            {totalCount} {totalCount === 1 ? "template" : "templates"}
          </span>
        )}
      </div>

      {/* What is filtered right now, each removable */}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((c) => (
            <button key={c.label} type="button" onClick={c.clear} className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1 rounded-full bg-[var(--brand-subtle)] border border-[var(--brand-glow)] text-xs font-medium text-[var(--brand)] hover:bg-[var(--brand-glow)] transition-colors" aria-label={`Remove filter ${c.label}`}>
              {c.label} <X className="w-3 h-3" />
            </button>
          ))}
          <button type="button" onClick={clearAllFilters} className="text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)] underline underline-offset-2">
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
