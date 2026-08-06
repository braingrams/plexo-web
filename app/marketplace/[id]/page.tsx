import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";

import { auth } from "@/server/auth";
import { getMarketplaceTemplateDetail } from "@/lib/marketplace";
import { PurchaseAction } from "./PurchaseAction";
import { PreviewButton } from "./PreviewButton";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const detail = await getMarketplaceTemplateDetail(id, null);
  if (!detail) return { title: "Template not found" };

  const title = `${detail.name} — Free Plexo Template`;
  const description =
    detail.description ??
    `${detail.kind === "LANDING_PAGE" ? "Landing page" : "Email"} template for Plexo. Use it directly or customize it in the drag-and-drop builder.`;

  return {
    title,
    description,
    alternates: { canonical: `/marketplace/${id}` },
    openGraph: { title, description, type: "website" },
  };
}

export default async function MarketplaceTemplateDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ purchase?: string }>;
}) {
  const { id } = await params;
  const { purchase } = await searchParams;
  const session = await auth.api.getSession({ headers: await headers() });
  const detail = await getMarketplaceTemplateDetail(id, session?.user?.id ?? null);

  if (!detail) notFound();

  const isFree = detail.priceCents === 0;
  // Successful Stripe redirect lands back here with ?purchase=success — if the webhook has
  // already recorded the purchase (detail.owned), skip the extra click and go straight into
  // the editor instead of making the user hit "Use this template" themselves.
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
    <div className="min-h-screen bg-[#0b0f19] text-slate-100">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
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

        <div className="mt-8 flex items-center gap-3">
          <PurchaseAction
            templateId={detail.id}
            isFree={isFree}
            owned={detail.owned}
            isLoggedIn={!!session?.user}
            autoUse={autoUse}
          />
          <PreviewButton templateId={detail.id} />
        </div>
      </div>
    </div>
  );
}
