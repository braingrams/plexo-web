"use client";

import { useState, useTransition, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import {
  Search, X, Sparkles, Layout, Mail, CheckCircle2, ArrowRight, ExternalLink,
  Monitor, Tablet, Smartphone, Users, Zap, ShieldCheck, Layers, ChevronLeft, ChevronRight
} from "lucide-react";

import type { MarketplaceListItem } from "@/lib/marketplace";

type DeviceMode = "desktop" | "tablet" | "mobile";

export function MarketplaceClient({
  templates,
  total,
  categories,
  page,
  pageSize,
  current,
}: {
  templates: MarketplaceListItem[];
  total: number;
  categories: string[];
  page: number;
  pageSize: number;
  current: { category?: string; kind?: string; free?: string; q?: string; sort: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  // Active template state — default to first template in the list if available
  const [activeTemplate, setActiveTemplate] = useState<MarketplaceListItem | null>(
    templates.length > 0 ? templates[0] : null
  );

  // Device mode for the live preview pane
  const [deviceMode, setDeviceMode] = useState<DeviceMode>("desktop");

  // Search input state
  const [searchValue, setSearchValue] = useState(current.q ?? "");

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Category counts map
  const categoryCounts = templates.reduce((acc, t) => {
    if (t.category) {
      acc[t.category] = (acc[t.category] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

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

  const deviceWidths: Record<DeviceMode, string> = {
    desktop: "100%",
    tablet: "768px",
    mobile: "375px",
  };

  return (
    <div className="flex flex-col gap-8 w-full">
      {/* Category Pills Header Bar */}
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
          <span className={`ml-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
            !current.category ? "bg-white/20 text-white" : "bg-[var(--surface-border)] text-[var(--text-muted)]"
          }`}>
            {total}
          </span>
        </button>

        {categories.map((cat) => {
          const isActive = current.category === cat;
          const count = categoryCounts[cat];
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

      {/* Search & Filter Controls Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 p-4 rounded-2xl bg-[var(--surface)] border border-[var(--surface-border)] backdrop-blur-xl shadow-xl">
        {/* Search Input */}
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

        {/* Filter Dropdowns & Segmented Toggles */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Kind Toggle */}
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
            className="rounded-xl border border-[var(--surface-border)] bg-[var(--bg-1)] px-3.5 py-2 text-xs font-medium text-[var(--text-main)] outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-glow)]"
          >
            <option value="">All Prices</option>
            <option value="true">Free Only</option>
            <option value="false">Paid Only</option>
          </select>

          {/* Sort Select */}
          <select
            value={current.sort}
            onChange={(e) => updateFilters({ sort: e.target.value })}
            className="rounded-xl border border-[var(--surface-border)] bg-[var(--bg-1)] px-3.5 py-2 text-xs font-medium text-[var(--text-main)] outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-glow)]"
          >
            <option value="popular">Most Popular</option>
            <option value="latest">Latest Released</option>
          </select>

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

      {/* =================================================================
         MASTER-DETAIL SPLIT SCREEN CONTAINER
         ================================================================= */}
      {templates.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start relative">
          {/* =============================================================
             LEFT MASTER PANEL (38% Width / 5 Cols): List of Templates
             ============================================================= */}
          <div className="lg:col-span-5 flex flex-col gap-3">
            <div className="flex items-center justify-between px-1 pb-1">
              <span className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">
                Select Template ({templates.length})
              </span>
              <span className="text-xs text-[var(--text-faint)]">Hover or click to preview</span>
            </div>

            {templates.map((t) => {
              const isSelected = activeTemplate?.id === t.id;
              const isFree = t.priceCents === 0;

              return (
                <div
                  key={t.id}
                  onMouseEnter={() => setActiveTemplate(t)}
                  onClick={() => setActiveTemplate(t)}
                  className={`group relative p-4 rounded-2xl border transition-all duration-200 cursor-pointer ${
                    isSelected
                      ? "bg-[var(--bg-1)] border-[var(--brand)] shadow-lg shadow-[var(--brand-glow)] translate-x-1"
                      : "bg-[var(--surface)] border-[var(--surface-border)] hover:border-[var(--brand-glow)] hover:bg-[var(--bg-2)]"
                  }`}
                >
                  <div className="flex flex-col gap-2">
                    {/* Top Row: Category & Price Tag */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[var(--bg-2)] text-[var(--brand)] border border-[var(--surface-border)]">
                        {t.kind === "LANDING_PAGE" ? <Layout className="w-3 h-3" /> : <Mail className="w-3 h-3" />}
                        {t.category ?? (t.kind === "LANDING_PAGE" ? "Landing Page" : "Email")}
                      </span>
                      <span
                        className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                          isFree
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                            : "bg-[var(--brand-subtle)] text-[var(--brand)] border border-[var(--brand-glow)]"
                        }`}
                      >
                        {isFree ? "Free" : `$${(t.priceCents / 100).toFixed(2)}`}
                      </span>
                    </div>

                    {/* Template Name & Description */}
                    <div>
                      <h3 className={`text-base font-bold transition-colors line-clamp-1 ${
                        isSelected ? "text-[var(--brand)]" : "text-[var(--text-main)] group-hover:text-[var(--brand)]"
                      }`}>
                        {t.name}
                      </h3>
                      {t.description && (
                        <p className="text-xs text-[var(--text-muted)] line-clamp-2 mt-1 leading-relaxed">
                          {t.description}
                        </p>
                      )}
                    </div>

                    {/* Footer Stats & Selection Indicator */}
                    <div className="flex items-center justify-between pt-2 border-t border-[var(--surface-border)] text-xs text-[var(--text-muted)]">
                      <div className="flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-[var(--text-faint)]" />
                        <span>{t.purchaseCount.toLocaleString()} imports</span>
                      </div>
                      <span className={`text-xs font-semibold flex items-center gap-1 transition-all ${
                        isSelected ? "text-[var(--brand)] opacity-100" : "opacity-0 group-hover:opacity-100 text-[var(--text-muted)]"
                      }`}>
                        Previewing <ArrowRight className="w-3.5 h-3.5" />
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-4 pt-4 border-t border-[var(--surface-border)]">
                {page > 1 && (
                  <Link
                    href={`/marketplace?${new URLSearchParams({
                      ...(current.category ? { category: current.category } : {}),
                      ...(current.kind ? { kind: current.kind } : {}),
                      ...(current.free ? { free: current.free } : {}),
                      ...(current.q ? { q: current.q } : {}),
                      sort: current.sort,
                      page: String(page - 1),
                    }).toString()}`}
                    className="p-2 rounded-xl bg-[var(--surface)] border border-[var(--surface-border)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition-all"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Link>
                )}

                <span className="text-xs text-[var(--text-muted)] font-medium px-2">
                  Page {page} of {totalPages}
                </span>

                {page < totalPages && (
                  <Link
                    href={`/marketplace?${new URLSearchParams({
                      ...(current.category ? { category: current.category } : {}),
                      ...(current.kind ? { kind: current.kind } : {}),
                      ...(current.free ? { free: current.free } : {}),
                      ...(current.q ? { q: current.q } : {}),
                      sort: current.sort,
                      page: String(page + 1),
                    }).toString()}`}
                    className="p-2 rounded-xl bg-[var(--surface)] border border-[var(--surface-border)] text-[var(--text-muted)] hover:text-[var(--text-main)] transition-all"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Link>
                )}
              </div>
            )}
          </div>

          {/* =============================================================
             RIGHT DETAIL PANEL (62% Width / 7 Cols): Sticky Live Preview Viewport
             ============================================================= */}
          <div className="lg:col-span-7 sticky top-24">
            {activeTemplate ? (
              <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--bg-1)] p-4 backdrop-blur-2xl shadow-2xl space-y-4">
                {/* Header Bar: Title, Category, Device Switcher, Primary CTA */}
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--surface-border)]">
                  <div className="flex items-center gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-[var(--brand)]">
                          {activeTemplate.category ?? (activeTemplate.kind === "LANDING_PAGE" ? "Landing Page" : "Email")}
                        </span>
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                          activeTemplate.priceCents === 0
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                            : "bg-[var(--brand-subtle)] text-[var(--brand)] border border-[var(--brand-glow)]"
                        }`}>
                          {activeTemplate.priceCents === 0 ? "Free" : `$${(activeTemplate.priceCents / 100).toFixed(2)}`}
                        </span>
                      </div>
                      <h2 className="text-xl font-extrabold text-[var(--text-main)] tracking-tight line-clamp-1">
                        {activeTemplate.name}
                      </h2>
                    </div>
                  </div>

                  {/* Device Size Switcher */}
                  <div className="flex items-center gap-1 bg-[var(--surface)] p-1 rounded-xl border border-[var(--surface-border)]">
                    <button
                      type="button"
                      onClick={() => setDeviceMode("desktop")}
                      title="Desktop View (100%)"
                      className={`p-1.5 rounded-lg text-xs font-medium transition-all ${
                        deviceMode === "desktop"
                          ? "bg-[var(--brand)] text-white shadow-sm"
                          : "text-[var(--text-muted)] hover:text-[var(--text-main)]"
                      }`}
                    >
                      <Monitor className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeviceMode("tablet")}
                      title="Tablet View (768px)"
                      className={`p-1.5 rounded-lg text-xs font-medium transition-all ${
                        deviceMode === "tablet"
                          ? "bg-[var(--brand)] text-white shadow-sm"
                          : "text-[var(--text-muted)] hover:text-[var(--text-main)]"
                      }`}
                    >
                      <Tablet className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeviceMode("mobile")}
                      title="Mobile View (375px)"
                      className={`p-1.5 rounded-lg text-xs font-medium transition-all ${
                        deviceMode === "mobile"
                          ? "bg-[var(--brand)] text-white shadow-sm"
                          : "text-[var(--text-muted)] hover:text-[var(--text-main)]"
                      }`}
                    >
                      <Smartphone className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Primary Action Button */}
                  <Link
                    href={`/marketplace/${activeTemplate.id}`}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--brand)] text-xs font-bold text-white shadow-lg shadow-[var(--brand-glow)] hover:opacity-90 transition-all hover:scale-105"
                  >
                    Use Template <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>

                {/* Viewport Frame */}
                <div className="h-[520px] w-full bg-[var(--bg)] rounded-xl border border-[var(--surface-border)] overflow-hidden flex items-center justify-center p-3 relative shadow-inner">
                  <div
                    style={{ width: deviceWidths[deviceMode] }}
                    className="h-full transition-all duration-300 ease-out bg-white rounded-lg shadow-2xl overflow-hidden relative"
                  >
                    {activeTemplate.compiledHtml ? (
                      <iframe
                        title={`Preview ${activeTemplate.name}`}
                        srcDoc={activeTemplate.compiledHtml}
                        sandbox=""
                        className="w-full h-full border-none"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-[var(--bg-1)] text-[var(--text-muted)] gap-2">
                        <Layers className="w-10 h-10 text-[var(--brand)] opacity-40" />
                        <span className="text-xs">No snapshot preview</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Specifications Bar Underneath */}
                <div className="flex flex-wrap items-center justify-between gap-4 pt-2 text-xs text-[var(--text-muted)]">
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span>Visual Builder Editable</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span>Responsive Layout</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span>1-Click Deploy</span>
                    </div>
                  </div>

                  <Link
                    href={`/marketplace/${activeTemplate.id}`}
                    className="text-xs font-semibold text-[var(--brand)] hover:underline flex items-center gap-1"
                  >
                    View Details <ExternalLink className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            ) : (
              <div className="h-96 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] flex flex-col items-center justify-center text-center p-6">
                <Layers className="w-10 h-10 text-[var(--text-faint)] mb-3" />
                <h3 className="text-base font-bold text-[var(--text-main)]">Select a Template</h3>
                <p className="text-xs text-[var(--text-muted)] max-w-xs mt-1">
                  Hover or click any template from the list on the left to see its live preview and details.
                </p>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Empty State */
        <div className="flex flex-col items-center justify-center py-24 text-center rounded-3xl border border-[var(--surface-border)] bg-[var(--surface)] p-8 backdrop-blur-xl">
          <div className="w-16 h-16 rounded-2xl bg-[var(--brand-subtle)] border border-[var(--brand-glow)] flex items-center justify-center text-[var(--brand)] mb-4 shadow-xl">
            <Search className="w-8 h-8" />
          </div>
          <h3 className="text-xl font-bold text-[var(--text-main)] mb-2">No templates match those filters</h3>
          <p className="text-sm text-[var(--text-muted)] max-w-md mb-6 leading-relaxed">
            We couldn&apos;t find any templates matching your search criteria or category filters. Try resetting search parameters.
          </p>
          <button
            type="button"
            onClick={clearAllFilters}
            className="px-5 py-2.5 rounded-xl bg-[var(--brand)] text-xs font-semibold text-white hover:opacity-90 transition-all shadow-lg shadow-[var(--brand-glow)]"
          >
            Reset All Filters
          </button>
        </div>
      )}
    </div>
  );
}
