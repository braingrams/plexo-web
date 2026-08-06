"use client";

import { useState } from "react";
import Link from "next/link";

import type { MarketplaceListItem } from "@/lib/marketplace";
import { TemplatePreviewModal } from "./TemplatePreviewModal";

function IconEye() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function TemplateCard({ template }: { template: MarketplaceListItem }) {
  const isFree = template.priceCents === 0;
  const [previewing, setPreviewing] = useState(false);

  return (
    <div className="relative rounded-xl border border-slate-800 bg-slate-900/40 p-5 hover:border-violet-700/50 transition-colors">
      <Link href={`/marketplace/${template.id}`} className="absolute inset-0 z-0" aria-label={template.name} />

      <div className="relative pointer-events-none">
        <div className="flex items-start justify-between mb-2">
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-400">
            {template.kind === "LANDING_PAGE" ? "Landing page" : "Email"}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setPreviewing(true);
              }}
              className="pointer-events-auto flex items-center gap-1 rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-300 hover:bg-slate-700 hover:text-white"
            >
              <IconEye /> Preview
            </button>
            <span className={`text-sm font-semibold ${isFree ? "text-emerald-400" : "text-slate-200"}`}>
              {isFree ? "Free" : `$${(template.priceCents / 100).toFixed(2)}`}
            </span>
          </div>
        </div>
        <h3 className="text-base font-medium text-slate-100 mb-1">{template.name}</h3>
        {template.category && <p className="text-xs text-violet-400 mb-1.5">{template.category}</p>}
        {template.description && <p className="text-sm text-slate-500 line-clamp-2">{template.description}</p>}
        <p className="text-xs text-slate-600 mt-3">{template.purchaseCount.toLocaleString()} people using this</p>
      </div>

      {previewing && <TemplatePreviewModal templateId={template.id} onClose={() => setPreviewing(false)} />}
    </div>
  );
}
