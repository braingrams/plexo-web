import Link from "next/link";
import { TemplateKind } from "@prisma/client";

import { listMarketplaceTemplates } from "@/lib/marketplace";
import { MarketplaceFilters } from "./MarketplaceFilters";
import { TemplateCard } from "./TemplateCard";

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; kind?: string; free?: string; q?: string; sort?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const kind = sp.kind === "EMAIL" || sp.kind === "LANDING_PAGE" ? (sp.kind as TemplateKind) : undefined;
  const free = sp.free === "true" ? true : sp.free === "false" ? false : undefined;
  const sort = sp.sort === "popular" ? "popular" : "latest";

  const { templates, total, categories, page, pageSize } = await listMarketplaceTemplates({
    category: sp.category,
    kind,
    free,
    q: sp.q,
    sort,
    page: Number(sp.page) || 1,
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="min-h-screen bg-[#0b0f19] text-slate-100">
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">Template marketplace</h1>
          <p className="text-sm text-slate-400 mt-1">
            {total.toLocaleString()} template{total === 1 ? "" : "s"} — free and premium, ready to publish.
          </p>
        </div>

        <MarketplaceFilters
          categories={categories}
          current={{ category: sp.category, kind: sp.kind, free: sp.free, q: sp.q, sort }}
        />

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-6">
          {templates.map((t) => (
            <TemplateCard key={t.id} template={t} />
          ))}
        </div>

        {templates.length === 0 && (
          <div className="text-center text-slate-500 py-20 text-sm">No templates match those filters.</div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-10">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => {
              const params = new URLSearchParams({
                ...(sp.category ? { category: sp.category } : {}),
                ...(sp.kind ? { kind: sp.kind } : {}),
                ...(sp.free ? { free: sp.free } : {}),
                ...(sp.q ? { q: sp.q } : {}),
                sort,
                page: String(p),
              });
              return (
                <Link
                  key={p}
                  href={`/marketplace?${params.toString()}`}
                  className={`rounded-lg px-3 py-1.5 text-sm ${
                    p === page ? "bg-violet-600 text-white" : "bg-slate-900 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {p}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
