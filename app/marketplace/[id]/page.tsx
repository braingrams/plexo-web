import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";

import { auth } from "@/server/auth";
import { getMarketplaceTemplateDetail } from "@/lib/marketplace";
import { PurchaseAction } from "./PurchaseAction";

export default async function MarketplaceTemplateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  const detail = await getMarketplaceTemplateDetail(id, session?.user?.id ?? null);

  if (!detail) notFound();

  const isFree = detail.priceCents === 0;

  return (
    <div className="min-h-screen bg-[#0b0f19] text-slate-100">
      <div className="max-w-2xl mx-auto px-6 py-12">
        <Link href="/marketplace" className="text-sm text-slate-500 hover:text-slate-300">
          ← Back to marketplace
        </Link>

        <div className="mt-4 flex items-start justify-between">
          <div>
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-400">
              {detail.kind === "LANDING_PAGE" ? "Landing page" : "Email"}
            </span>
            <h1 className="text-2xl font-bold mt-2">{detail.name}</h1>
            {detail.category && <p className="text-sm text-violet-400 mt-1">{detail.category}</p>}
          </div>
          <span className={`text-xl font-semibold ${isFree ? "text-emerald-400" : "text-slate-100"}`}>
            {isFree ? "Free" : `$${(detail.priceCents / 100).toFixed(2)}`}
          </span>
        </div>

        {detail.description && <p className="text-sm text-slate-400 mt-4 leading-relaxed">{detail.description}</p>}

        <p className="text-xs text-slate-600 mt-4">
          {detail.purchaseCount.toLocaleString()} people using this template
        </p>

        <div className="mt-8">
          <PurchaseAction
            templateId={detail.id}
            isFree={isFree}
            owned={detail.owned}
            isLoggedIn={!!session?.user}
          />
        </div>
      </div>
    </div>
  );
}
