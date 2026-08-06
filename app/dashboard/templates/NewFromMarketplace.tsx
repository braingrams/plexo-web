"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TemplatePreviewModal } from "@/app/marketplace/TemplatePreviewModal";

function IconEye() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

type MarketplaceItem = {
  id: string;
  name: string;
  kind: "EMAIL" | "LANDING_PAGE";
  category: string | null;
  priceCents: number;
};

/**
 * In-modal "start from a template" step for the New Template flow. Reads the existing
 * public, unauthenticated GET /api/v1/marketplace/templates (same endpoint the SDK/AI
 * tools use) — no new backend route needed. Free templates clone straight into the
 * caller's account via the existing /use route and drop them into the editor; paid
 * templates hand off to the standalone /marketplace/[id] page, which already owns the
 * full Stripe checkout flow.
 */
export function NewFromMarketplace({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<MarketplaceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ sort: "popular", ...(q.trim() ? { q: q.trim() } : {}) });
    fetch(`/api/v1/marketplace/templates?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setItems(data.templates ?? []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [q]);

  async function handleSelect(item: MarketplaceItem) {
    setError(null);

    if (item.priceCents > 0) {
      onClose();
      router.push(`/marketplace/${item.id}`);
      return;
    }

    setBusyId(item.id);
    const res = await fetch(`/api/v1/marketplace/templates/${item.id}/use`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok) {
      setError(data.error ?? "Failed to use this template.");
      return;
    }
    onClose();
    router.push(`/dashboard/templates/${data.template.id}`);
  }

  return (
    <div>
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search marketplace templates…"
        style={{
          width: "100%",
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 10,
          color: "#f0f2ff",
          padding: "0.65rem 0.9rem",
          fontSize: "0.875rem",
          outline: "none",
          fontFamily: "inherit",
        }}
      />

      {error && (
        <p style={{ fontSize: "0.8rem", color: "#f87171", marginTop: "0.6rem" }} role="alert">
          {error}
        </p>
      )}

      <div style={{ maxHeight: 340, overflowY: "auto", marginTop: "0.75rem", display: "grid", gap: "0.5rem" }}>
        {items.map((item) => {
          const isFree = item.priceCents === 0;
          return (
            <div
              key={item.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "0.75rem",
                padding: "0.75rem 1rem",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.03)",
              }}
            >
              <button
                type="button"
                onClick={() => void handleSelect(item)}
                disabled={busyId === item.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  minWidth: 0,
                  flex: 1,
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: busyId === item.id ? "wait" : "pointer",
                  textAlign: "left",
                  fontFamily: "inherit",
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: "0.875rem", fontWeight: 600, color: "#f0f2ff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.name}
                  </span>
                  <span style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.4)" }}>
                    {item.kind === "LANDING_PAGE" ? "Landing page" : "Email"}
                    {item.category ? ` · ${item.category}` : ""}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setPreviewId(item.id)}
                title="Preview"
                aria-label={`Preview ${item.name}`}
                style={{
                  flexShrink: 0, display: "grid", placeItems: "center",
                  width: 28, height: 28, borderRadius: 8,
                  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                  color: "rgba(240,242,255,0.6)", cursor: "pointer",
                }}
              >
                <IconEye />
              </button>
              <span style={{ flexShrink: 0, fontSize: "0.8rem", fontWeight: 700, color: isFree ? "#34d399" : "#f0f2ff" }}>
                {busyId === item.id ? "Working…" : isFree ? "Free" : `$${(item.priceCents / 100).toFixed(2)}`}
              </span>
            </div>
          );
        })}
        {!loading && items.length === 0 && (
          <p style={{ textAlign: "center", color: "rgba(240,242,255,0.4)", fontSize: "0.85rem", padding: "1.5rem 0" }}>
            No templates found.
          </p>
        )}
      </div>

      {previewId && <TemplatePreviewModal templateId={previewId} onClose={() => setPreviewId(null)} />}
    </div>
  );
}
