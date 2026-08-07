import type { Metadata } from "next";
import Link from "next/link";
import { TemplateKind } from "@prisma/client";
import { Sparkles, SearchX, ChevronLeft, ChevronRight, Zap, ShieldCheck, Smartphone } from "lucide-react";

import { listMarketplaceTemplates } from "@/lib/marketplace";
import { LandingNav } from "../landing-nav";
import { MarketplaceFilters } from "./MarketplaceFilters";
import { MarketplaceRowExpandGrid } from "./MarketplaceRowExpandGrid";

export const metadata: Metadata = {
  title: "Template Marketplace — Premium Landing Page & Email Designs | Plexo",
  description:
    "Explore ready-made email and landing page templates built for high conversion with Plexo. Filter by category, preview live in multi-device views, and launch in minutes.",
  alternates: { canonical: "/marketplace" },
};

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; kind?: string; free?: string; q?: string; sort?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const kind = sp.kind === "EMAIL" || sp.kind === "LANDING_PAGE" ? (sp.kind as TemplateKind) : undefined;
  const free = sp.free === "true" ? true : sp.free === "false" ? false : undefined;
  const sort = sp.sort === "popular" ? "popular" : "latest";

  const { templates, total, categories, page, pageSize } = await listMarketplaceTemplates({
    category: sp.category,
    kind,
    free,
    q: sp.q,
    sort,
    page: Number(sp.page) || 1,
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Category counts map
  const categoryCounts = templates.reduce((acc, t) => {
    if (t.category) {
      acc[t.category] = (acc[t.category] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-main)] selection:bg-[var(--brand)] selection:text-white transition-colors duration-300">
      {/* Top Site Navigation Header */}
      <LandingNav />

      {/* Hero Header Section */}
      <section className="relative pt-32 pb-14 px-6 overflow-hidden border-b border-[var(--surface-border)]">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[450px] bg-gradient-to-b from-[var(--brand-glow)] via-transparent to-transparent blur-3xl pointer-events-none -z-10" />

        <div className="max-w-6xl mx-auto flex flex-col items-center text-center">
          {/* Eyebrow Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[var(--surface)] border border-[var(--brand-glow)] text-xs font-semibold text-[var(--brand)] shadow-xl backdrop-blur-md mb-6">
            <Sparkles className="w-3.5 h-3.5 text-[var(--brand)] animate-pulse" />
            <span>Plexo Marketplace · Premium Production Templates</span>
          </div>

          {/* Hero Heading */}
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight max-w-3xl leading-[1.12] mb-6 gradient-text">
            Discover & Deploy World-Class Templates
          </h1>

          {/* Subtitle */}
          <p className="text-base md:text-lg text-[var(--text-muted)] max-w-2xl leading-relaxed mb-8">
            Curated collection of high-converting landing pages and responsive email designs. Hover over any template to stretch it full-width with a live HTML preview.
          </p>

          {/* Feature Highlights */}
          <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-[var(--text-muted)] font-medium">
            <div className="flex items-center gap-1.5 bg-[var(--surface)] px-3.5 py-1.5 rounded-full border border-[var(--surface-border)]">
              <Zap className="w-3.5 h-3.5 text-amber-400" /> Instant 1-Click Import
            </div>
            <div className="flex items-center gap-1.5 bg-[var(--surface)] px-3.5 py-1.5 rounded-full border border-[var(--surface-border)]">
              <Smartphone className="w-3.5 h-3.5 text-[var(--brand)]" /> Multi-Device Viewport Preview
            </div>
            <div className="flex items-center gap-1.5 bg-[var(--surface)] px-3.5 py-1.5 rounded-full border border-[var(--surface-border)]">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Production & Mobile Ready
            </div>
          </div>
        </div>
      </section>

      {/* Main Browse Marketplace Container */}
      <main className="max-w-6xl mx-auto px-6 py-12">
        {/* Filter Controls Panel */}
        <div className="mb-10">
          <MarketplaceFilters
            categories={categories}
            categoryCounts={categoryCounts}
            totalCount={total}
            current={{ category: sp.category, kind: sp.kind, free: sp.free, q: sp.q, sort }}
          />
        </div>

        {/* Row-Chunked Expandable Grid */}
        {templates.length > 0 ? (
          <MarketplaceRowExpandGrid templates={templates} />
        ) : (
          /* Empty State Graphic */
          <div className="flex flex-col items-center justify-center py-24 text-center rounded-3xl border border-[var(--surface-border)] bg-[var(--surface)] p-8 backdrop-blur-xl">
            <div className="w-16 h-16 rounded-2xl bg-[var(--brand-subtle)] border border-[var(--brand-glow)] flex items-center justify-center text-[var(--brand)] mb-4 shadow-xl">
              <SearchX className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-[var(--text-main)] mb-2">No matching templates found</h3>
            <p className="text-sm text-[var(--text-muted)] max-w-md mb-6 leading-relaxed">
              We couldn&apos;t find any templates matching your search criteria or category filters. Try resetting search parameters.
            </p>
            <Link
              href="/marketplace"
              className="px-5 py-2.5 rounded-xl bg-[var(--brand)] text-xs font-semibold text-white hover:opacity-90 transition-all shadow-lg shadow-[var(--brand-glow)]"
            >
              Reset All Filters
            </Link>
          </div>
        )}

        {/* Pagination Bar */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-14 pt-8 border-t border-[var(--surface-border)]">
            {page > 1 && (
              <Link
                href={`/marketplace?${new URLSearchParams({
                  ...(sp.category ? { category: sp.category } : {}),
                  ...(sp.kind ? { kind: sp.kind } : {}),
                  ...(sp.free ? { free: sp.free } : {}),
                  ...(sp.q ? { q: sp.q } : {}),
                  sort,
                  page: String(page - 1),
                }).toString()}`}
                className="p-2.5 rounded-xl bg-[var(--surface)] border border-[var(--surface-border)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:border-[var(--brand-glow)] transition-all"
                title="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
              </Link>
            )}

            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => {
              const params = new URLSearchParams({
                ...(sp.category ? { category: sp.category } : {}),
                ...(sp.kind ? { kind: sp.kind } : {}),
                ...(sp.free ? { free: sp.free } : {}),
                ...(sp.q ? { q: sp.q } : {}),
                sort,
                page: String(p),
              });
              const isCurrent = p === page;
              return (
                <Link
                  key={p}
                  href={`/marketplace?${params.toString()}`}
                  className={`min-w-[40px] h-10 px-3.5 rounded-xl text-xs font-semibold flex items-center justify-center transition-all ${
                    isCurrent
                      ? "bg-[var(--brand)] text-white shadow-lg shadow-[var(--brand-glow)] scale-105"
                      : "bg-[var(--surface)] text-[var(--text-muted)] border border-[var(--surface-border)] hover:text-[var(--text-main)] hover:border-[var(--brand-glow)]"
                  }`}
                >
                  {p}
                </Link>
              );
            })}

            {page < totalPages && (
              <Link
                href={`/marketplace?${new URLSearchParams({
                  ...(sp.category ? { category: sp.category } : {}),
                  ...(sp.kind ? { kind: sp.kind } : {}),
                  ...(sp.free ? { free: sp.free } : {}),
                  ...(sp.q ? { q: sp.q } : {}),
                  sort,
                  page: String(page + 1),
                }).toString()}`}
                className="p-2.5 rounded-xl bg-[var(--surface)] border border-[var(--surface-border)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:border-[var(--brand-glow)] transition-all"
                title="Next page"
              >
                <ChevronRight className="w-4 h-4" />
              </Link>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
