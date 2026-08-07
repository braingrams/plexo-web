import Link from "next/link";
import { TemplateKind } from "@prisma/client";

import { listMarketplaceTemplates } from "@/lib/marketplace";
import { MarketplaceFilters } from "../../marketplace/MarketplaceFilters";
import { MarketplaceRowExpandGrid } from "../../marketplace/MarketplaceRowExpandGrid";
import { PageContainer } from "../_components/PageContainer";

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

  // Category counts map
  const categoryCounts = templates.reduce((acc, t) => {
    if (t.category) {
      acc[t.category] = (acc[t.category] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

  return (
    <PageContainer>
      {/* Header Bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", marginBottom: "2rem" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.75rem", fontWeight: 800, color: "var(--text-main)" }}>
            Template Marketplace
          </h1>
          <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
            Explore ready-made email and landing page templates. Hover any template card to stretch it full-width within its row.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.6rem", flexShrink: 0 }}>
          <Link
            href="/dashboard/marketplace/listings"
            style={{
              display: "inline-flex", alignItems: "center", padding: "0.6rem 1.1rem",
              borderRadius: 10, fontWeight: 600, fontSize: "0.82rem",
              border: "1px solid var(--surface-border)", color: "var(--text-main)",
              background: "var(--surface)", textDecoration: "none",
            }}
          >
            My listings
          </Link>
          <Link
            href="/dashboard/marketplace/payouts"
            style={{
              display: "inline-flex", alignItems: "center", padding: "0.6rem 1.1rem",
              borderRadius: 10, fontWeight: 600, fontSize: "0.82rem",
              border: "1px solid var(--surface-border)", color: "var(--text-main)",
              background: "var(--surface)", textDecoration: "none",
            }}
          >
            Payouts
          </Link>
          <Link
            href="/dashboard/marketplace/sell"
            style={{
              display: "inline-flex", alignItems: "center", padding: "0.6rem 1.1rem",
              borderRadius: 10, fontWeight: 700, fontSize: "0.82rem",
              background: "var(--brand)", color: "#fff", textDecoration: "none",
              boxShadow: "0 4px 12px var(--brand-glow)",
            }}
          >
            Sell a template
          </Link>
        </div>
      </div>

      {/* Filter Controls Panel */}
      <div style={{ marginBottom: "2rem" }}>
        <MarketplaceFilters
          categories={categories}
          categoryCounts={categoryCounts}
          totalCount={total}
          current={{ category: sp.category, kind: sp.kind, free: sp.free, q: sp.q, sort }}
        />
      </div>

      {/* Row-Chunked Expandable Grid */}
      {templates.length > 0 ? (
        <MarketplaceRowExpandGrid templates={templates} />
      ) : (
        <div style={{ textAlign: "center", color: "var(--text-muted)", padding: "5rem 0", fontSize: "0.875rem" }}>
          No templates match those filters.
        </div>
      )}

      {/* Pagination Bar */}
      {totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", marginTop: "3rem" }}>
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
                  borderRadius: 10,
                  padding: "0.5rem 1rem",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  background: p === page ? "var(--brand)" : "var(--surface)",
                  color: p === page ? "#fff" : "var(--text-muted)",
                  border: "1px solid var(--surface-border)",
                  textDecoration: "none",
                }}
              >
                {p}
              </Link>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}
