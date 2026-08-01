import Link from "next/link";
import { TemplateKind } from "@prisma/client";

import { listMarketplaceTemplates } from "@/lib/marketplace";
import { MarketplaceFilters } from "../../marketplace/MarketplaceFilters";
import { TemplateCard } from "../../marketplace/TemplateCard";

/**
 * In-app mirror of the public app/marketplace browse page — same data/components, just
 * rendered inside the dashboard shell so a logged-in user can discover templates without
 * leaving the app. Clicking a template still lands on the standalone /marketplace/[id]
 * page, which already owns the full buy/claim/use flow (PurchaseAction).
 */
export default async function DashboardMarketplacePage({
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
    <div style={{ padding: "2rem 8px", maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.5rem", fontWeight: 800, color: "#f0f2ff" }}>
          Template marketplace
        </h1>
        <p style={{ fontSize: "0.875rem", color: "rgba(240,242,255,0.5)", marginTop: "0.25rem" }}>
          {total.toLocaleString()} template{total === 1 ? "" : "s"} — free and premium, ready to publish.
        </p>
      </div>

      <MarketplaceFilters
        categories={categories}
        current={{ category: sp.category, kind: sp.kind, free: sp.free, q: sp.q, sort }}
      />

      <div className="templates-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1.25rem", marginTop: "1.5rem" }}>
        {templates.map((t) => (
          <TemplateCard key={t.id} template={t} />
        ))}
      </div>

      {templates.length === 0 && (
        <div style={{ textAlign: "center", color: "rgba(240,242,255,0.4)", padding: "5rem 0", fontSize: "0.875rem" }}>
          No templates match those filters.
        </div>
      )}

      {totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", marginTop: "2.5rem" }}>
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
                href={`/dashboard/marketplace?${params.toString()}`}
                style={{
                  borderRadius: 8,
                  padding: "0.4rem 0.9rem",
                  fontSize: "0.85rem",
                  background: p === page ? "var(--brand)" : "rgba(255,255,255,0.04)",
                  color: p === page ? "#fff" : "rgba(240,242,255,0.5)",
                }}
              >
                {p}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
