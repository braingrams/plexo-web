"use client";

import { useState } from "react";
import Link from "next/link";
import { Layout, Mail, ArrowRight, Users, Maximize2, Layers } from "lucide-react";

import type { MarketplaceListItem } from "@/lib/marketplace";
import { TemplatePreviewModal } from "./TemplatePreviewModal";

/**
 * Grid of marketplace template cards. Each card is preview-first: a live, scaled-down
 * iframe of the template's own compiledHtml fills the card by default (this is a template
 * marketplace — the design itself is the product, not a paragraph about it), with just the
 * name as a small always-visible label. Everything else — description, badges, price,
 * import count, and the Use/Preview actions — surfaces as an overlay on hover instead of
 * competing with the image for space at rest.
 *
 * The iframe scaling here is a lightweight CSS-only thumbnail trick (render at 4x, scale
 * back to 25%) — a separate, much simpler mechanism from both the old hover-triggered
 * row-reflow this replaces and the page builder's own live-editable preview mode in
 * plexo-sdk (PlexoBuilder.tsx's internalPreviewMode), which this deliberately does not
 * touch or reuse. TemplatePreviewModal (the fullscreen Maximize2 preview) is unchanged.
 */
export function MarketplaceRowExpandGrid({
  templates,
}: {
  templates: MarketplaceListItem[];
}) {
  const [previewingModalId, setPreviewingModalId] = useState<string | null>(null);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
      {templates.map((t) => {
        const isFree = t.priceCents === 0;

        return (
          <div
            key={t.id}
            className="group relative aspect-[4/3] rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] overflow-hidden transition-all duration-300 cursor-pointer backdrop-blur-xl hover:border-[var(--brand-glow)] hover:-translate-y-1 hover:shadow-xl hover:shadow-[var(--brand-glow)]"
          >
            <Link href={`/marketplace/${t.id}`} className="absolute inset-0 z-10" aria-label={t.name} />

            {/* Preview — dominant, always visible */}
            <div className="absolute inset-0 bg-white">
              {t.compiledHtml ? (
                <iframe
                  title={`Preview of ${t.name}`}
                  srcDoc={t.compiledHtml}
                  sandbox=""
                  tabIndex={-1}
                  style={{ width: "400%", height: "400%", transform: "scale(0.25)", transformOrigin: "top left", pointerEvents: "none" }}
                  className="border-none"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center bg-[var(--bg-1)] text-[var(--text-muted)] gap-2">
                  <Layers className="w-8 h-8 text-[var(--brand)] opacity-50" />
                  <span className="text-xs font-medium">No preview yet</span>
                </div>
              )}
            </div>

            {/* Always-on name label — just enough to orient while scanning */}
            <div className="absolute inset-x-0 bottom-0 z-20 p-3 bg-gradient-to-t from-black/70 to-transparent pointer-events-none transition-opacity duration-200 group-hover:opacity-0">
              <h3 className="text-sm font-bold text-white line-clamp-1 drop-shadow">{t.name}</h3>
            </div>

            {/* Hover overlay — everything else lives here */}
            <div className="absolute inset-0 z-20 flex flex-col justify-between p-5 bg-black/80 opacity-0 pointer-events-none transition-opacity duration-200 group-hover:opacity-100 group-hover:pointer-events-auto">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-white/10 text-white border border-white/15">
                  {t.kind === "LANDING_PAGE" ? <Layout className="w-3 h-3" /> : <Mail className="w-3 h-3" />}
                  {t.category ?? (t.kind === "LANDING_PAGE" ? "Landing Page" : "Email")}
                </span>
                <span
                  className={`text-xs font-bold px-3 py-1 rounded-full ${
                    isFree
                      ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                      : "bg-[var(--brand-subtle)] text-[var(--brand)] border border-[var(--brand-glow)]"
                  }`}
                >
                  {isFree ? "Free" : `$${(t.priceCents / 100).toFixed(2)}`}
                </span>
              </div>

              <div className="space-y-2">
                <h3 className="text-base font-bold text-white line-clamp-1">{t.name}</h3>
                {t.description && <p className="text-xs text-white/70 line-clamp-2 leading-relaxed">{t.description}</p>}

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/15">
                  <div className="flex items-center gap-1.5 text-xs text-white/60">
                    <Users className="w-3.5 h-3.5" />
                    <span>{t.purchaseCount.toLocaleString()} imports</span>
                  </div>
                  <div className="relative z-30 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        setPreviewingModalId(t.id);
                      }}
                      className="p-2 rounded-lg bg-white/10 border border-white/15 text-white hover:bg-white/20 transition-colors"
                      title="Fullscreen preview"
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                    </button>
                    <Link
                      href={`/marketplace/${t.id}`}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[var(--brand)] text-xs font-bold text-white shadow-lg shadow-[var(--brand-glow)] hover:opacity-90 transition-all"
                    >
                      Use Template <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {previewingModalId && (
        <TemplatePreviewModal templateId={previewingModalId} onClose={() => setPreviewingModalId(null)} />
      )}
    </div>
  );
}
