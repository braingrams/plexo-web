"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

import type { MarketplaceListItem } from "@/lib/marketplace";
import { MarketplaceFilters } from "@/app/marketplace/MarketplaceFilters";
import { MarketplaceRowExpandGrid } from "@/app/marketplace/MarketplaceRowExpandGrid";

type Filters = { category?: string; kind?: string; free?: string; q?: string; sort: string };

/**
 * The full marketplace-browsing experience (filters + row-expand grid + preview), reused
 * as a modal rather than the standalone /dashboard/marketplace page — entered from the
 * Templates toolbar and from the "New Template" flow's "Browse marketplace" option. Fetches
 * from the same public /api/v1/marketplace/templates route the standalone page's server
 * component reads from directly, since this runs client-side inside a modal instead.
 */
export function MarketplaceBrowseModal({ onClose }: { onClose: () => void }) {
  const [filters, setFilters] = useState<Filters>({ sort: "latest" });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{
    templates: MarketplaceListItem[];
    total: number;
    categories: string[];
    pageSize: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams();
    if (filters.category) params.set("category", filters.category);
    if (filters.kind) params.set("kind", filters.kind);
    if (filters.free) params.set("free", filters.free);
    if (filters.q) params.set("q", filters.q);
    params.set("sort", filters.sort);
    params.set("page", String(page));

    fetch(`/api/v1/marketplace/templates?${params.toString()}`)
      .then((res) => res.json())
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filters, page]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const categoryCounts = (data?.templates ?? []).reduce((acc, t) => {
    if (t.category) acc[t.category] = (acc[t.category] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Template Marketplace"
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(5,6,10,0.72)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "clamp(12px, 3vw, 32px)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "100%", height: "100%", maxWidth: 1600,
          background: "#0d0f1a",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 20,
          display: "flex", flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 40px 100px -20px rgba(0,0,0,0.6)",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "1.25rem 1.5rem", borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0,
        }}>
          <div>
            <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.35rem", fontWeight: 800, color: "#f0f2ff", margin: 0 }}>
              Template Marketplace
            </h2>
            <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.45)", margin: "0.25rem 0 0" }}>
              Pick a template to start your new one from.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close marketplace"
            style={{
              display: "grid", placeItems: "center", width: 36, height: 36, borderRadius: 10,
              background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)",
              color: "rgba(240,242,255,0.7)", cursor: "pointer", flexShrink: 0,
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "1.5rem" }}>
          <div style={{ marginBottom: "1.5rem" }}>
            <MarketplaceFilters
              categories={data?.categories ?? []}
              categoryCounts={categoryCounts}
              totalCount={data?.total}
              current={filters}
              onFilterChange={(next) => {
                setPage(1);
                setFilters({
                  category: next.category,
                  kind: next.kind,
                  free: next.free,
                  q: next.q,
                  sort: next.sort ?? "latest",
                });
              }}
            />
          </div>

          {loading && !data ? (
            <div style={{ textAlign: "center", color: "rgba(240,242,255,0.4)", padding: "5rem 0", fontSize: "0.875rem" }}>
              Loading templates…
            </div>
          ) : data && data.templates.length > 0 ? (
            <MarketplaceRowExpandGrid templates={data.templates} />
          ) : (
            <div style={{ textAlign: "center", color: "rgba(240,242,255,0.4)", padding: "5rem 0", fontSize: "0.875rem" }}>
              No templates match those filters.
            </div>
          )}

          {data && totalPages > 1 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", marginTop: "2.5rem" }}>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPage(p)}
                  style={{
                    borderRadius: 10, padding: "0.5rem 1rem", fontSize: "0.85rem", fontWeight: 600,
                    background: p === page ? "var(--brand)" : "rgba(255,255,255,0.04)",
                    color: p === page ? "#fff" : "rgba(240,242,255,0.6)",
                    border: "1px solid rgba(255,255,255,0.08)", cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
