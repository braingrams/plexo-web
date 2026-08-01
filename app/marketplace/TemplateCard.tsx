import Link from "next/link";

import type { MarketplaceListItem } from "@/lib/marketplace";

export function TemplateCard({ template }: { template: MarketplaceListItem }) {
  const isFree = template.priceCents === 0;

  return (
    <Link
      href={`/marketplace/${template.id}`}
      className="block rounded-xl border border-slate-800 bg-slate-900/40 p-5 hover:border-violet-700/50 transition-colors"
    >
      <div className="flex items-start justify-between mb-2">
        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-400">
          {template.kind === "LANDING_PAGE" ? "Landing page" : "Email"}
        </span>
        <span className={`text-sm font-semibold ${isFree ? "text-emerald-400" : "text-slate-200"}`}>
          {isFree ? "Free" : `$${(template.priceCents / 100).toFixed(2)}`}
        </span>
      </div>
      <h3 className="text-base font-medium text-slate-100 mb-1">{template.name}</h3>
      {template.category && <p className="text-xs text-violet-400 mb-1.5">{template.category}</p>}
      {template.description && <p className="text-sm text-slate-500 line-clamp-2">{template.description}</p>}
      <p className="text-xs text-slate-600 mt-3">{template.purchaseCount.toLocaleString()} people using this</p>
    </Link>
  );
}
