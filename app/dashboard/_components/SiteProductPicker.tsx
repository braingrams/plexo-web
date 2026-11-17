"use client";

import { useEffect, useMemo, useState } from "react";
import { formatMoney } from "@/lib/commerce/formatMoney";

export type PickableProduct = { id: string; name: string; kind: string; priceMinor: number; currency: string; imageUrl?: string | null; priceLabel: string };

/** The site's sellable products (not services — those are booked), newest first. Shared by every place that asks "which product?". */
export function useSiteProducts(siteId: string) {
  const [products, setProducts] = useState<PickableProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setProducts(null);
    setError(null);
    fetch(`/api/v1/commerce/${siteId}/products`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "We couldn't load your products.");
        return data.products as Array<{ id: string; name: string; kind: string; priceMinor: number; currency: string; imageUrl?: string | null; active?: boolean }>;
      })
      .then((rows) => {
        if (!alive) return;
        setProducts(
          rows
            .filter((p) => p.active !== false && p.kind !== "SERVICE")
            .map((p) => ({ id: p.id, name: p.name, kind: p.kind, priceMinor: p.priceMinor, currency: p.currency, imageUrl: p.imageUrl, priceLabel: formatMoney(p.priceMinor, p.currency) })),
        );
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : "We couldn't load your products."));
    return () => {
      alive = false;
    };
  }, [siteId, attempt]);
  return { products, error, retry: () => setAttempt((n) => n + 1) };
}

const ink = "var(--plx-text, #f0f2ff)";
const muted = "color-mix(in srgb, var(--plx-text, rgb(240 242 255)) 50%, transparent)";
const line = "1px solid color-mix(in srgb, var(--plx-text, #fff) 10%, transparent)";

/**
 * Pick which product — by its picture, name and price, never by pasting a code. Dark, to sit in
 * the dashboard's modals.
 */
export function SiteProductPicker({ siteId, value, onChange }: { siteId: string; value: string; onChange: (id: string) => void }) {
  const { products, error, retry } = useSiteProducts(siteId);
  const [query, setQuery] = useState("");
  const shown = useMemo(() => (products ?? []).filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase())), [products, query]);

  // With one product there is nothing to choose: have it ready.
  useEffect(() => {
    if (!value && products && products.length === 1) onChange(products[0].id);
  }, [products, value, onChange]);

  if (error)
    return (
      <p style={{ fontSize: "0.8rem", color: "var(--plx-danger, #fca5a5)", margin: 0 }}>
        {error}{" "}
        <button type="button" onClick={retry} style={{ background: "none", border: "none", color: "var(--plx-link, var(--brand))", cursor: "pointer", padding: 0, fontSize: "0.8rem", fontWeight: 600 }}>
          Try again
        </button>
      </p>
    );
  if (!products) return <p style={{ fontSize: "0.8rem", color: muted, margin: 0 }}>Loading your products…</p>;
  if (products.length === 0)
    return (
      <p style={{ fontSize: "0.8rem", color: muted, margin: 0, lineHeight: 1.5 }}>
        You have no products to sell yet.{" "}
        <a href={`/dashboard/commerce/${siteId}/products`} style={{ color: "var(--plx-link, var(--brand))", fontWeight: 600 }}>
          Create your first product
        </a>
      </p>
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {products.length > 5 && (
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your products"
          style={{ width: "100%", padding: "0.5rem 0.7rem", borderRadius: 8, fontSize: "0.82rem", border: line, background: "color-mix(in srgb, var(--plx-text, #fff) 3%, transparent)", color: ink, fontFamily: "inherit" }}
        />
      )}
      <div role="radiogroup" style={{ display: "flex", flexDirection: "column", gap: "0.4rem", maxHeight: 220, overflowY: "auto" }}>
        {shown.map((p) => {
          const chosen = p.id === value;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={chosen}
              onClick={() => onChange(p.id)}
              style={{
                display: "flex", alignItems: "center", gap: "0.7rem", textAlign: "left", padding: "0.5rem 0.65rem", borderRadius: 10, cursor: "pointer", fontFamily: "inherit",
                background: chosen ? "color-mix(in srgb, var(--plx-brand, rgb(var(--brand-rgb))) 14%, transparent)" : "color-mix(in srgb, var(--plx-text, #fff) 3%, transparent)",
                border: chosen ? "1px solid color-mix(in srgb, var(--plx-brand, rgb(var(--brand-rgb))) 45%, transparent)" : line,
                color: ink,
              }}
            >
              {p.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.imageUrl} alt="" style={{ width: 38, height: 38, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} />
              ) : (
                <span style={{ width: 38, height: 38, borderRadius: 6, background: "color-mix(in srgb, var(--plx-text, #fff) 6%, transparent)", flexShrink: 0 }} />
              )}
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                <span style={{ display: "block", fontSize: "0.74rem", color: muted }}>{p.priceLabel}{p.kind === "DIGITAL" ? " · digital" : ""}</span>
              </span>
              {chosen && <span aria-hidden style={{ color: "var(--plx-link, var(--brand))", fontWeight: 800 }}>✓</span>}
            </button>
          );
        })}
        {shown.length === 0 && <p style={{ fontSize: "0.8rem", color: muted, margin: 0 }}>No product matches "{query}".</p>}
      </div>
    </div>
  );
}
