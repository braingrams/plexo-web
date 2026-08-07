"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Sparkles, Layout, Mail, CheckCircle2, ArrowRight, ExternalLink,
  Monitor, Tablet, Smartphone, Users, Maximize2, Layers
} from "lucide-react";

import type { MarketplaceListItem } from "@/lib/marketplace";
import { TemplatePreviewModal } from "./TemplatePreviewModal";

type DeviceMode = "desktop" | "tablet" | "mobile";

export function MarketplaceRowExpandGrid({
  templates,
}: {
  templates: MarketplaceListItem[];
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [deviceMode, setDeviceMode] = useState<DeviceMode>("desktop");
  const [previewingModalId, setPreviewingModalId] = useState<string | null>(null);

  const deviceWidths: Record<DeviceMode, string> = {
    desktop: "100%",
    tablet: "768px",
    mobile: "375px",
  };

  // Chunk templates into rows of 3 items each
  const rows: MarketplaceListItem[][] = [];
  for (let i = 0; i < templates.length; i += 3) {
    rows.push(templates.slice(i, i + 3));
  }

  return (
    <div className="flex flex-col gap-6 w-full">
      {rows.map((row, rowIndex) => {
        const hoveredItem = row.find((t) => t.id === hoveredId);
        const remainingRowItems = hoveredItem ? row.filter((t) => t.id !== hoveredItem.id) : [];

        return (
          <div key={`row-${rowIndex}`} className="flex flex-col gap-6 w-full">
            {!hoveredItem ? (
              /* =============================================================
                 UNHOVERED ROW: Standard 3-Column Grid
                 ============================================================= */
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-start">
                {row.map((t) => {
                  const isFree = t.priceCents === 0;

                  return (
                    <div
                      key={t.id}
                      onMouseEnter={() => setHoveredId(t.id)}
                      className="group relative flex flex-col justify-between rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-5 transition-all duration-300 cursor-pointer backdrop-blur-xl hover:border-[var(--brand-glow)] hover:bg-[var(--bg-2)] hover:-translate-y-1 hover:shadow-xl hover:shadow-[var(--brand-glow)] min-h-[200px]"
                    >
                      <Link href={`/marketplace/${t.id}`} className="absolute inset-0 z-10" aria-label={t.name} />

                      <div>
                        {/* Badges */}
                        <div className="flex items-center justify-between gap-2 mb-3">
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-[var(--bg-2)] text-[var(--brand)] border border-[var(--surface-border)]">
                            {t.kind === "LANDING_PAGE" ? <Layout className="w-3 h-3" /> : <Mail className="w-3 h-3" />}
                            {t.category ?? (t.kind === "LANDING_PAGE" ? "Landing Page" : "Email")}
                          </span>
                          <span
                            className={`text-xs font-bold px-3 py-1 rounded-full ${
                              isFree
                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                                : "bg-[var(--brand-subtle)] text-[var(--brand)] border border-[var(--brand-glow)]"
                            }`}
                          >
                            {isFree ? "Free" : `$${(t.priceCents / 100).toFixed(2)}`}
                          </span>
                        </div>

                        {/* Title & Description */}
                        <div className="space-y-1.5 mb-4">
                          <h3 className="text-base font-bold text-[var(--text-main)] group-hover:text-[var(--brand)] transition-colors line-clamp-1">
                            {t.name}
                          </h3>
                          {t.description && (
                            <p className="text-xs text-[var(--text-muted)] line-clamp-2 leading-relaxed">
                              {t.description}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Footer */}
                      <div className="flex items-center justify-between pt-3 border-t border-[var(--surface-border)] text-xs text-[var(--text-muted)] mt-auto">
                        <div className="flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5 text-[var(--text-faint)]" />
                          <span>{t.purchaseCount.toLocaleString()} imports</span>
                        </div>
                        <span className="text-xs font-semibold text-[var(--brand)] flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                          Hover to stretch <ArrowRight className="w-3.5 h-3.5" />
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* =============================================================
                 HOVERED ROW: Visibly Stretched Item + Remaining Peers (50% Width)
                 ============================================================= */
              <div className="flex flex-col gap-6 w-full stretch-panel-animated">
                {/* 1. Stretched Hovered Item (Full Width Panel) */}
                <div
                  onMouseLeave={() => setHoveredId(null)}
                  className="w-full rounded-3xl border border-[var(--brand-glow)] bg-[var(--bg-1)] p-6 md:p-8 backdrop-blur-2xl shadow-2xl overflow-hidden transition-all duration-300"
                >
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
                    {/* Left Column: Information & Primary Actions */}
                    <div className="lg:col-span-5 space-y-4 text-left">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-bold bg-[var(--brand)] text-white shadow-md">
                          <Sparkles className="w-3.5 h-3.5" />
                          {hoveredItem.category ?? (hoveredItem.kind === "LANDING_PAGE" ? "Landing Page" : "Email")}
                        </span>
                        <span
                          className={`text-xs font-extrabold px-3 py-1 rounded-full ${
                            hoveredItem.priceCents === 0
                              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                              : "bg-[var(--brand-subtle)] text-[var(--brand)] border border-[var(--brand-glow)]"
                          }`}
                        >
                          {hoveredItem.priceCents === 0 ? "Free Template" : `$${(hoveredItem.priceCents / 100).toFixed(2)}`}
                        </span>
                      </div>

                      <h2 className="text-2xl md:text-3xl font-extrabold text-[var(--text-main)] tracking-tight">
                        {hoveredItem.name}
                      </h2>

                      <p className="text-sm text-[var(--text-muted)] leading-relaxed line-clamp-3">
                        {hoveredItem.description ?? "High-converting visual design template optimized for maximum visitor engagement, mobile responsiveness, and drag-and-drop customization."}
                      </p>

                      {/* Features Checklist */}
                      <div className="grid grid-cols-2 gap-2 text-xs text-[var(--text-main)] font-medium pt-1">
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Visual Builder Ready
                        </div>
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Fully Responsive
                        </div>
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" /> 1-Click Import
                        </div>
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Production Ready
                        </div>
                      </div>

                      {/* Primary Actions */}
                      <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-[var(--surface-border)]">
                        <Link
                          href={`/marketplace/${hoveredItem.id}`}
                          className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[var(--brand)] text-xs font-bold text-white shadow-lg shadow-[var(--brand-glow)] hover:opacity-90 transition-all hover:scale-105"
                        >
                          Use Template in Editor <ArrowRight className="w-4 h-4" />
                        </Link>
                        <button
                          type="button"
                          onClick={() => setPreviewingModalId(hoveredItem.id)}
                          className="p-3 rounded-xl bg-[var(--surface)] border border-[var(--surface-border)] text-xs font-semibold text-[var(--text-main)] hover:border-[var(--brand-glow)] hover:bg-[var(--bg-2)] transition-colors"
                          title="Fullscreen Preview Modal"
                        >
                          <Maximize2 className="w-4 h-4 text-[var(--brand)]" />
                        </button>
                      </div>
                    </div>

                    {/* Right Column: Live Scaled HTML Iframe Preview Shell */}
                    <div className="lg:col-span-7 h-80 rounded-2xl bg-[var(--bg)] border border-[var(--surface-border)] overflow-hidden relative shadow-2xl flex flex-col">
                      {/* Window Header Controls & Device Switcher */}
                      <div className="h-9 bg-[var(--bg-2)] px-4 flex items-center justify-between border-b border-[var(--surface-border)] z-20">
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
                            <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
                          </div>
                          <span className="text-[11px] font-mono text-[var(--text-muted)] hidden sm:inline-block">
                            {hoveredItem.name.toLowerCase().replace(/\s+/g, "-")}.preview
                          </span>
                        </div>

                        {/* Viewport Toggles */}
                        <div className="flex items-center gap-1 bg-[var(--surface)] p-1 rounded-lg border border-[var(--surface-border)]">
                          <button
                            type="button"
                            onClick={() => setDeviceMode("desktop")}
                            title="Desktop View (100%)"
                            className={`p-1 rounded text-xs font-medium transition-all ${
                              deviceMode === "desktop"
                                ? "bg-[var(--brand)] text-white shadow-sm"
                                : "text-[var(--text-muted)] hover:text-[var(--text-main)]"
                            }`}
                          >
                            <Monitor className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeviceMode("tablet")}
                            title="Tablet View (768px)"
                            className={`p-1 rounded text-xs font-medium transition-all ${
                              deviceMode === "tablet"
                                ? "bg-[var(--brand)] text-white shadow-sm"
                                : "text-[var(--text-muted)] hover:text-[var(--text-main)]"
                            }`}
                          >
                            <Tablet className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeviceMode("mobile")}
                            title="Mobile View (375px)"
                            className={`p-1 rounded text-xs font-medium transition-all ${
                              deviceMode === "mobile"
                                ? "bg-[var(--brand)] text-white shadow-sm"
                                : "text-[var(--text-muted)] hover:text-[var(--text-main)]"
                            }`}
                          >
                            <Smartphone className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Live Scaled Preview Viewport */}
                      <div className="flex-1 bg-white relative flex items-center justify-center overflow-hidden">
                        <div
                          style={{ width: deviceWidths[deviceMode] }}
                          className="h-full transition-all duration-300 ease-out bg-white shadow-2xl relative"
                        >
                          {hoveredItem.compiledHtml ? (
                            <iframe
                              title={`Preview ${hoveredItem.name}`}
                              srcDoc={hoveredItem.compiledHtml}
                              sandbox=""
                              className="w-full h-full border-none"
                            />
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center bg-[var(--bg-1)] text-[var(--text-muted)] gap-2">
                              <Layers className="w-8 h-8 text-[var(--brand)] opacity-50" />
                              <span className="text-xs font-medium">Live Snapshot Preview</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. Remaining Peers of the Row Pushed Directly Below (50% width each) */}
                {remainingRowItems.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-start animate-in fade-in duration-300">
                    {remainingRowItems.map((t) => {
                      const isFree = t.priceCents === 0;

                      return (
                        <div
                          key={t.id}
                          onMouseEnter={() => setHoveredId(t.id)}
                          className="group relative flex flex-col justify-between rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-5 transition-all duration-300 cursor-pointer backdrop-blur-xl hover:border-[var(--brand-glow)] hover:bg-[var(--bg-2)] hover:-translate-y-1 hover:shadow-xl hover:shadow-[var(--brand-glow)] min-h-[200px]"
                        >
                          <Link href={`/marketplace/${t.id}`} className="absolute inset-0 z-10" aria-label={t.name} />

                          <div>
                            {/* Badges */}
                            <div className="flex items-center justify-between gap-2 mb-3">
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-[var(--bg-2)] text-[var(--brand)] border border-[var(--surface-border)]">
                                {t.kind === "LANDING_PAGE" ? <Layout className="w-3 h-3" /> : <Mail className="w-3 h-3" />}
                                {t.category ?? (t.kind === "LANDING_PAGE" ? "Landing Page" : "Email")}
                              </span>
                              <span
                                className={`text-xs font-bold px-3 py-1 rounded-full ${
                                  isFree
                                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                                    : "bg-[var(--brand-subtle)] text-[var(--brand)] border border-[var(--brand-glow)]"
                                }`}
                              >
                                {isFree ? "Free" : `$${(t.priceCents / 100).toFixed(2)}`}
                              </span>
                            </div>

                            {/* Title & Description */}
                            <div className="space-y-1.5 mb-4">
                              <h3 className="text-base font-bold text-[var(--text-main)] group-hover:text-[var(--brand)] transition-colors line-clamp-1">
                                {t.name}
                              </h3>
                              {t.description && (
                                <p className="text-xs text-[var(--text-muted)] line-clamp-2 leading-relaxed">
                                  {t.description}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Footer */}
                          <div className="flex items-center justify-between pt-3 border-t border-[var(--surface-border)] text-xs text-[var(--text-muted)] mt-auto">
                            <div className="flex items-center gap-1.5">
                              <Users className="w-3.5 h-3.5 text-[var(--text-faint)]" />
                              <span>{t.purchaseCount.toLocaleString()} imports</span>
                            </div>
                            <span className="text-xs font-semibold text-[var(--brand)] flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                              Hover to stretch <ArrowRight className="w-3.5 h-3.5" />
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      <style jsx>{`
        @keyframes expandStretch {
          0% {
            opacity: 0;
            max-height: 0px;
            transform: scaleY(0.92);
          }
          100% {
            opacity: 1;
            max-height: 900px;
            transform: scaleY(1);
          }
        }

        .stretch-panel-animated {
          animation: expandStretch 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          transform-origin: top center;
        }
      `}</style>

      {previewingModalId && (
        <TemplatePreviewModal templateId={previewingModalId} onClose={() => setPreviewingModalId(null)} />
      )}
    </div>
  );
}
