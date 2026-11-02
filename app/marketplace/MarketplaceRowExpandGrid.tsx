"use client";

import { useState } from "react";
import Link from "next/link";
import { Layout, Mail, Eye, Layers, ArrowRight } from "lucide-react";

import type { MarketplaceListItem } from "@/lib/marketplace";
import { TemplatePreviewModal } from "./TemplatePreviewModal";

/**
 * The template cards. Each is a picture of the design with its name, what it is for and its price printed
 * underneath, never over it, so every card reads at a glance without hovering (and on a phone, where there is no
 * hover). The whole card opens the template's page; "Preview" opens a full-size look without leaving the list.
 *
 * The picture is a live, scaled-down copy of the template's own compiled page (rendered at 4x and shrunk to 25%).
 */
export function MarketplaceRowExpandGrid({
  templates,
  onSelect,
  busyId,
}: {
  templates: MarketplaceListItem[];
  /** When given, picking a card calls this (e.g. the new-site wizard) instead of opening the template's page. */
  onSelect?: (t: MarketplaceListItem) => void;
  busyId?: string | null;
}) {
  const [previewingModalId, setPreviewingModalId] = useState<string | null>(null);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-9 w-full">
      {templates.map((t) => {
        const isFree = t.priceCents === 0;
        const what = t.kind === "LANDING_PAGE" ? "Web page" : "Email";

        return (
          <article key={t.id} className="group relative flex flex-col">
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(t)}
                disabled={!!busyId}
                className="absolute inset-0 z-10 rounded-2xl cursor-pointer disabled:cursor-wait"
                aria-label={`Use ${t.name}`}
              />
            ) : (
              <Link href={`/marketplace/${t.id}`} className="absolute inset-0 z-10 rounded-2xl" aria-label={`${t.name}: open template`} />
            )}

            <div className="relative aspect-[4/3] rounded-2xl border border-[var(--surface-border)] bg-white overflow-hidden transition-all duration-300 group-hover:border-[var(--brand-glow)] group-hover:-translate-y-1 group-hover:shadow-xl group-hover:shadow-[var(--brand-glow)]">
              {t.compiledHtml ? (
                <iframe
                  title={`Preview of ${t.name}`}
                  srcDoc={t.compiledHtml}
                  sandbox=""
                  tabIndex={-1}
                  loading="lazy"
                  style={{ width: "400%", height: "400%", transform: "scale(0.25)", transformOrigin: "top left", pointerEvents: "none" }}
                  className="border-none"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center bg-[var(--bg-1)] text-[var(--text-muted)] gap-2">
                  <Layers className="w-8 h-8 text-[var(--brand)] opacity-50" />
                  <span className="text-xs font-medium">No preview yet</span>
                </div>
              )}
              <span className="absolute left-3 top-3 z-20 px-2.5 py-1 rounded-full text-[11px] font-bold shadow-sm bg-white/95 text-slate-900">
                {isFree ? "Free" : `$${(t.priceCents / 100).toFixed(2)}`}
              </span>
              <span className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center p-3 opacity-0 translate-y-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-y-0 focus-within:opacity-100">
                <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--brand)] text-xs font-bold text-white shadow-lg">
                  {busyId === t.id ? "Setting up…" : <>Use this template <ArrowRight className="w-3.5 h-3.5" /></>}
                </span>
              </span>
            </div>

            <div className="flex items-start justify-between gap-3 pt-3.5 px-1">
              <div className="min-w-0">
                <h3 className="text-[15px] font-bold leading-snug text-[var(--text-main)] group-hover:text-[var(--brand)] transition-colors line-clamp-2">{t.name}</h3>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                  {t.kind === "LANDING_PAGE" ? <Layout className="w-3.5 h-3.5 shrink-0" /> : <Mail className="w-3.5 h-3.5 shrink-0" />}
                  <span className="truncate">{what}{t.category ? ` · ${t.category}` : ""}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewingModalId(t.id)}
                className="relative z-20 shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--surface-border)] bg-[var(--surface)] text-xs font-semibold text-[var(--text-main)] hover:border-[var(--brand-glow)] hover:text-[var(--brand)] transition-colors"
              >
                <Eye className="w-3.5 h-3.5" /> Preview
              </button>
            </div>
          </article>
        );
      })}

      {previewingModalId && <TemplatePreviewModal templateId={previewingModalId} onClose={() => setPreviewingModalId(null)} />}
    </div>
  );
}
