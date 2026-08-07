"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Sparkles, Layout, Mail, CheckCircle2, ArrowRight, ExternalLink,
  Monitor, Tablet, Smartphone, Users, Maximize2, Layers, Flame, Eye
} from "lucide-react";

import type { MarketplaceListItem } from "@/lib/marketplace";
import { TemplatePreviewModal } from "./TemplatePreviewModal";

type DeviceMode = "desktop" | "tablet" | "mobile";

export function MarketplaceInlineDrawerGrid({
  templates,
}: {
  templates: MarketplaceListItem[];
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [deviceMode, setDeviceMode] = useState<DeviceMode>("desktop");
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  const deviceWidths: Record<DeviceMode, string> = {
    desktop: "100%",
    tablet: "768px",
    mobile: "375px",
  };

  const hoveredIndex = templates.findIndex((t) => t.id === hoveredId);
  const hoveredTemplate = hoveredIndex !== -1 ? templates[hoveredIndex] : null;

  // Determine rowEndIndex for 3-column layout (default LG desktop)
  const lgRowEndIndex =
    hoveredIndex !== -1
      ? Math.min(templates.length - 1, Math.floor(hoveredIndex / 3) * 3 + 2)
      : -1;

  return (
    <div className="w-full">
      {/* 3-Column Uniform Grid Container */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-start">
        {templates.map((t, idx) => {
          const isHovered = hoveredId === t.id;
          const isFree = t.priceCents === 0;
          const isRowEnd = idx === lgRowEndIndex;

          return (
            <div key={t.id} className="contents">
              {/* Individual Uniform Grid Card */}
              <div
                onMouseEnter={() => setHoveredId(t.id)}
                className={`group relative flex flex-col justify-between rounded-2xl border p-5 transition-all duration-300 cursor-pointer backdrop-blur-xl ${
                  isHovered
                    ? "bg-[var(--bg-1)] border-[var(--brand)] shadow-xl shadow-[var(--brand-glow)] -translate-y-1"
                    : "bg-[var(--surface)] border-[var(--surface-border)] hover:border-[var(--brand-glow)] hover:bg-[var(--bg-2)] hover:-translate-y-1"
                }`}
              >
                <Link href={`/marketplace/${t.id}`} className="absolute inset-0 z-10" aria-label={t.name} />

                <div>
                  {/* Card Header Badges */}
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
                    <h3 className={`text-base font-bold transition-colors line-clamp-1 ${
                      isHovered ? "text-[var(--brand)]" : "text-[var(--text-main)] group-hover:text-[var(--brand)]"
                    }`}>
                      {t.name}
                    </h3>
                    {t.description && (
                      <p className="text-xs text-[var(--text-muted)] line-clamp-2 leading-relaxed">
                        {t.description}
                      </p>
                    )}
                  </div>
                </div>

                {/* Card Footer */}
                <div className="flex items-center justify-between pt-3 border-t border-[var(--surface-border)] text-xs text-[var(--text-muted)] mt-auto">
                  <div className="flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-[var(--text-faint)]" />
                    <span>{t.purchaseCount.toLocaleString()} imports</span>
                  </div>
                  <span className={`text-xs font-semibold flex items-center gap-1 transition-all ${
                    isHovered ? "text-[var(--brand)]" : "text-[var(--text-muted)] group-hover:text-[var(--brand)]"
                  }`}>
                    {isHovered ? "Previewing ↓" : "Hover to preview ↓"}
                  </span>
                </div>
              </div>

              {/* =============================================================
                 INLINE ROW PREVIEW DRAWER (Renders directly beneath current row)
                 ============================================================= */}
              {isRowEnd && hoveredTemplate && (
                <div className="col-span-1 md:col-span-2 lg:col-span-3 rounded-3xl border border-[var(--brand-glow)] bg-[var(--bg-1)] p-6 md:p-8 backdrop-blur-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-4 duration-300 my-2">
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
                    {/* Left Column: Details & CTAs */}
                    <div className="lg:col-span-5 space-y-4 text-left">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-[var(--brand)] text-white shadow-md">
                          <Sparkles className="w-3.5 h-3.5" />
                          {hoveredTemplate.category ?? (hoveredTemplate.kind === "LANDING_PAGE" ? "Landing Page" : "Email")}
                        </span>
                        <span
                          className={`text-xs font-extrabold px-3 py-1 rounded-full ${
                            hoveredTemplate.priceCents === 0
                              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                              : "bg-[var(--brand-subtle)] text-[var(--brand)] border border-[var(--brand-glow)]"
                          }`}
                        >
                          {hoveredTemplate.priceCents === 0 ? "Free Template" : `$${(hoveredTemplate.priceCents / 100).toFixed(2)}`}
                        </span>
                      </div>

                      <h2 className="text-2xl font-extrabold text-[var(--text-main)] tracking-tight">
                        {hoveredTemplate.name}
                      </h2>

                      <p className="text-sm text-[var(--text-muted)] leading-relaxed line-clamp-3">
                        {hoveredTemplate.description ?? "High-converting visual template designed for seamless user engagement and mobile responsiveness."}
                      </p>

                      {/* Feature Specifications Checklist */}
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
                      <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-[var(--surface-border)]">
                        <Link
                          href={`/marketplace/${hoveredTemplate.id}`}
                          className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[var(--brand)] text-xs font-bold text-white shadow-lg shadow-[var(--brand-glow)] hover:opacity-90 transition-all hover:scale-105"
                        >
                          Use Template in Editor <ArrowRight className="w-4 h-4" />
                        </Link>
                        <button
                          type="button"
                          onClick={() => setPreviewingId(hoveredTemplate.id)}
                          className="p-3 rounded-xl bg-[var(--surface)] border border-[var(--surface-border)] text-xs font-semibold text-[var(--text-main)] hover:border-[var(--brand-glow)] hover:bg-[var(--bg-2)] transition-colors"
                          title="Fullscreen Modal Preview"
                        >
                          <Maximize2 className="w-4 h-4 text-[var(--brand)]" />
                        </button>
                      </div>
                    </div>

                    {/* Right Column: Scaled HTML Iframe Preview Frame */}
                    <div className="lg:col-span-7 h-80 rounded-2xl bg-[var(--bg)] border border-[var(--surface-border)] overflow-hidden relative shadow-2xl flex flex-col">
                      {/* Window Header & Device Viewport Controls */}
                      <div className="h-9 bg-[var(--bg-2)] px-4 flex items-center justify-between border-b border-[var(--surface-border)] z-20">
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
                            <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
                          </div>
                          <span className="text-[11px] font-mono text-[var(--text-muted)] hidden sm:inline-block">
                            {hoveredTemplate.name.toLowerCase().replace(/\s+/g, "-")}.preview
                          </span>
                        </div>

                        {/* Device Size Switcher */}
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

                      {/* Scaled Preview Frame */}
                      <div className="flex-1 bg-white relative flex items-center justify-center overflow-hidden">
                        <div
                          style={{ width: deviceWidths[deviceMode] }}
                          className="h-full transition-all duration-300 ease-out bg-white shadow-2xl relative"
                        >
                          {hoveredTemplate.compiledHtml ? (
                            <iframe
                              title={`Inline Preview ${hoveredTemplate.name}`}
                              srcDoc={hoveredTemplate.compiledHtml}
                              sandbox=""
                              className="w-full h-full border-none"
                            />
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center bg-[var(--bg-1)] text-[var(--text-muted)] gap-2">
                              <Layers className="w-8 h-8 text-[var(--brand)] opacity-50" />
                              <span className="text-xs">Live Snapshot Preview</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {previewingId && (
        <TemplatePreviewModal templateId={previewingId} onClose={() => setPreviewingId(null)} />
      )}
    </div>
  );
}
