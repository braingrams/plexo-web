"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, ArrowRight, Layout, Mail, Users } from "lucide-react";

import type { MarketplaceListItem } from "@/lib/marketplace";
import { TemplatePreviewModal } from "./TemplatePreviewModal";

export function TemplateCard({ template }: { template: MarketplaceListItem }) {
  const isFree = template.priceCents === 0;
  const [previewing, setPreviewing] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  return (
    <>
      <div
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className="group relative flex flex-col justify-between rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-5 transition-all duration-300 backdrop-blur-xl hover:border-[var(--brand-glow)] hover:bg-[var(--bg-2)] hover:-translate-y-1.5 hover:shadow-xl hover:shadow-[var(--brand-glow)]"
      >
        <Link href={`/marketplace/${template.id}`} className="absolute inset-0 z-10" aria-label={template.name} />

        <div>
          {/* Card Top Badges */}
          <div className="flex items-center justify-between gap-2 mb-3">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-[var(--bg-2)] text-[var(--brand)] border border-[var(--surface-border)]">
              {template.kind === "LANDING_PAGE" ? <Layout className="w-3 h-3" /> : <Mail className="w-3 h-3" />}
              {template.category ?? (template.kind === "LANDING_PAGE" ? "Landing Page" : "Email")}
            </span>
            <span
              className={`text-xs font-bold px-3 py-1 rounded-full ${
                isFree
                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                  : "bg-[var(--brand-subtle)] text-[var(--brand)] border border-[var(--brand-glow)]"
              }`}
            >
              {isFree ? "Free" : `$${(template.priceCents / 100).toFixed(2)}`}
            </span>
          </div>

          {/* Template Info */}
          <div className="space-y-1.5 mb-4">
            <h3 className="text-base font-bold text-[var(--text-main)] group-hover:text-[var(--brand)] transition-colors line-clamp-1">
              {template.name}
            </h3>
            {template.description && (
              <p className="text-xs text-[var(--text-muted)] line-clamp-2 leading-relaxed">
                {template.description}
              </p>
            )}
          </div>
        </div>

        {/* Card Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-[var(--surface-border)] text-xs text-[var(--text-muted)] mt-auto">
          <div className="flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-[var(--text-faint)]" />
            <span>{template.purchaseCount.toLocaleString()} imports</span>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setPreviewing(true);
            }}
            className="z-20 pointer-events-auto text-xs font-semibold text-[var(--brand)] hover:underline flex items-center gap-1"
          >
            <Eye className="w-3.5 h-3.5" /> Preview
          </button>
        </div>
      </div>

      {previewing && <TemplatePreviewModal templateId={template.id} onClose={() => setPreviewing(false)} />}
    </>
  );
}
