import Link from "next/link";
import { ArrowLeft, Layout, Mail, Users, CheckCircle2, Layers } from "lucide-react";

import type { MarketplaceDetail } from "@/lib/marketplace";
import { PurchaseAction } from "./PurchaseAction";
import { PreviewButton } from "./PreviewButton";

/** The classic dashboard's view of one design (people on the new dashboard see _v3/designs/DesignDetail instead). */
export function ClassicDesignPage({ detail, purchase, signedIn }: { detail: MarketplaceDetail; purchase?: string; signedIn: boolean }) {
  const isFree = detail.priceCents === 0;
  const autoUse = purchase === "success" && detail.owned;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: detail.name,
    description: detail.description ?? undefined,
    category: detail.category ?? undefined,
    offers: {
      "@type": "Offer",
      price: (detail.priceCents / 100).toFixed(2),
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
    },
  };

  return (
    <div className="bg-[var(--bg)] text-[var(--text-main)] selection:bg-[var(--brand)] selection:text-white transition-colors duration-300">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Hero Detail Section */}
      <div className="relative pt-4 pb-20 px-2">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[450px] bg-gradient-to-b from-[var(--brand-glow)] via-transparent to-transparent blur-3xl pointer-events-none -z-10" />

        <div className="max-w-6xl mx-auto">
          {/* Breadcrumb Back Link */}
          <Link
            href="/dashboard/marketplace"
            className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors mb-8 bg-[var(--surface)] px-3.5 py-1.5 rounded-full border border-[var(--surface-border)]"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Marketplace
          </Link>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
            {/* Left Column: Template Information */}
            <div className="lg:col-span-6 space-y-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[var(--bg-2)] text-[var(--text-main)] border border-[var(--surface-border)]">
                  {detail.kind === "LANDING_PAGE" ? <Layout className="w-3.5 h-3.5 text-[var(--brand)]" /> : <Mail className="w-3.5 h-3.5 text-[var(--brand)]" />}
                  {detail.kind === "LANDING_PAGE" ? "Landing Page" : "Email Template"}
                </span>

                {detail.category && (
                  <span className="px-3 py-1 rounded-full text-xs font-semibold bg-[var(--brand-subtle)] text-[var(--brand)] border border-[var(--brand-glow)]">
                    {detail.category}
                  </span>
                )}

                <span
                  className={`px-3 py-1 rounded-full text-xs font-extrabold ${
                    isFree
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                      : "bg-[var(--brand-subtle)] text-[var(--brand)] border border-[var(--brand-glow)]"
                  }`}
                >
                  {isFree ? "Free Template" : `$${(detail.priceCents / 100).toFixed(2)}`}
                </span>
              </div>

              <h1 className="text-3xl md:text-5xl font-extrabold text-[var(--text-main)] tracking-tight">
                {detail.name}
              </h1>

              {detail.description && (
                <p className="text-sm md:text-base text-[var(--text-muted)] leading-relaxed">
                  {detail.description}
                </p>
              )}

              {/* Usage stats */}
              <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] pt-1">
                <Users className="w-4 h-4 text-[var(--brand)]" />
                <span>Used by <strong>{detail.purchaseCount.toLocaleString()}</strong> creators and teams</span>
              </div>

              {/* Features List */}
              <div className="pt-4 border-t border-[var(--surface-border)] space-y-3">
                <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">Template Specifications</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-[var(--text-main)]">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Fully Editable in Visual Builder
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" /> 100% Mobile & Desktop Responsive
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Exportable HTML / CSS Output
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Lifetime Updates Included
                  </div>
                </div>
              </div>

              {/* Action CTAs */}
              <div className="pt-6 flex flex-wrap items-center gap-4">
                <PurchaseAction
                  templateId={detail.id}
                  isFree={isFree}
                  owned={detail.owned}
                  isLoggedIn={signedIn}
                  autoUse={autoUse}
                />
                <PreviewButton templateId={detail.id} />
              </div>
            </div>

            {/* Right Column: Live Iframe Visual Frame */}
            <div className="lg:col-span-6">
              <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--bg-1)] p-2 shadow-2xl overflow-hidden relative group">
                <div className="h-8 bg-[var(--bg-2)] rounded-t-xl px-3 flex items-center justify-between border-b border-[var(--surface-border)] mb-2">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
                  </div>
                  <span className="text-[11px] font-mono text-[var(--text-muted)]">{detail.name.toLowerCase().replace(/\s+/g, "-")}</span>
                </div>

                <div className="relative h-[480px] w-full rounded-b-xl overflow-hidden bg-white">
                  {detail.compiledHtml ? (
                    <iframe
                      title={`Preview ${detail.name}`}
                      srcDoc={detail.compiledHtml}
                      sandbox=""
                      className="w-full h-full border-0"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center bg-[var(--bg-1)] text-[var(--text-muted)] gap-2">
                      <Layers className="w-10 h-10 text-[var(--brand)] opacity-40" />
                      <span className="text-xs">No snapshot preview</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
