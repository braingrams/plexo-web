"use client";

import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import { useState } from "react";
import { formatMoney } from "@/lib/commerce/formatMoney";
import { SUPPORTED_STORE_CURRENCIES } from "@/lib/commerce/currency";

export type DiscountSummary = {
  id: string;
  code: string;
  type: "PERCENT" | "FIXED";
  value: number;
  active: boolean;
  expiresAt: string | null;
  usageLimit: number | null;
  usedCount: number;
  createdAt: string;
};

function formatValue(d: Pick<DiscountSummary, "type" | "value">, currency: string): string {
  return d.type === "PERCENT" ? `${d.value}% off` : `${formatMoney(d.value, currency)} off`;
}

const inputStyle: React.CSSProperties = {
  width: "100%", background: "color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 4%, transparent)", border: "1px solid color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 10%, transparent)",
  borderRadius: 9, color: "var(--cmx-text, #f0f2ff)", padding: "0.55rem 0.75rem", fontSize: "0.85rem",
  outline: "none", fontFamily: "inherit",
};

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "var(--cmx-text, #c5cbe8)", marginBottom: "0.35rem" }}>{label}</span>
      {children}
    </label>
  );
}

export function DiscountsClient({ templateId, initialDiscounts, currency }: { templateId: string; initialDiscounts: DiscountSummary[]; currency: string }) {
  const currencySymbol = SUPPORTED_STORE_CURRENCIES.find((c) => c.code === currency)?.symbol ?? currency;
  const [discounts, setDiscounts] = useState(initialDiscounts);
  const [modalOpen, setModalOpen] = useState(false);
  const [code, setCode] = useState("");
  const [type, setType] = useState<"PERCENT" | "FIXED">("PERCENT");
  const [value, setValue] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [usageLimit, setUsageLimit] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiBase = `/api/v1/commerce/${templateId}/discounts`;

  function openCreate() {
    setCode("");
    setType("PERCENT");
    setValue("");
    setExpiresAt("");
    setUsageLimit("");
    setError(null);
    setModalOpen(true);
  }

  async function handleCreate() {
    setError(null);
    const numericValue = Math.round(type === "PERCENT" ? Number(value) : Number(value) * 100);
    if (!code.trim() || !Number.isFinite(numericValue) || numericValue <= 0) {
      setError("Enter a code and a valid value.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          type,
          value: numericValue,
          expiresAt: expiresAt || undefined,
          usageLimit: usageLimit ? Number(usageLimit) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create discount code.");
      setDiscounts((prev) => [
        {
          id: data.discount.id, code: data.discount.code, type: data.discount.type, value: data.discount.value,
          active: data.discount.active, expiresAt: data.discount.expiresAt, usageLimit: data.discount.usageLimit,
          usedCount: data.discount.usedCount, createdAt: data.discount.createdAt,
        },
        ...prev,
      ]);
      setModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create discount code.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(discount: DiscountSummary) {
    const res = await fetch(`${apiBase}/${discount.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !discount.active }),
    });
    if (res.ok) {
      setDiscounts((prev) => prev.map((d) => (d.id === discount.id ? { ...d, active: !d.active } : d)));
    }
  }

  async function handleDelete(discount: DiscountSummary) {
    const res = await fetch(`${apiBase}/${discount.id}`, { method: "DELETE" });
    if (res.ok) {
      setDiscounts((prev) => prev.filter((d) => d.id !== discount.id));
    }
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", marginBottom: "1.5rem" }}>
        <p style={{ fontSize: "0.85rem", color: "var(--cmx-muted, rgba(240,242,255,0.5))", margin: 0 }}>Percentage or fixed-amount codes customers can apply at checkout.</p>
        <button
          type="button" onClick={openCreate}
          style={{ padding: "0.6rem 1.1rem", borderRadius: 10, border: "none", cursor: "pointer", fontSize: "0.85rem", fontWeight: 700, fontFamily: "inherit", background: "linear-gradient(135deg,var(--brand),var(--cmx-brand-deep, var(--brand-deep)))", color: "var(--cmx-on-brand, #fff)" }}
        >
          + New Code
        </button>
      </div>

      {discounts.length === 0 ? (
        <div style={{ padding: "3rem 2rem", textAlign: "center", borderRadius: 14, border: "1px dashed color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 12%, transparent)", background: "color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 2%, transparent)", color: "var(--cmx-muted, rgba(240,242,255,0.45))", fontSize: "0.85rem" }}>
          No discount codes yet.
        </div>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 8%, transparent)", borderRadius: 14 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
            <thead>
              <tr style={{ color: "var(--cmx-muted, rgba(240,242,255,0.4))", textAlign: "left", background: "color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 2%, transparent)" }}>
                <th style={{ fontWeight: 500, padding: "0.7rem 1rem" }}>Code</th>
                <th style={{ fontWeight: 500, padding: "0.7rem 1rem" }}>Discount</th>
                <th style={{ fontWeight: 500, padding: "0.7rem 1rem" }}>Uses</th>
                <th style={{ fontWeight: 500, padding: "0.7rem 1rem" }}>Expires</th>
                <th style={{ fontWeight: 500, padding: "0.7rem 1rem" }}>Status</th>
                <th style={{ fontWeight: 500, padding: "0.7rem 1rem" }}></th>
              </tr>
            </thead>
            <tbody>
              {discounts.map((d) => (
                <tr key={d.id} style={{ borderTop: "1px solid color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 6%, transparent)", color: "var(--cmx-text, #e2e4f5)" }}>
                  <td style={{ padding: "0.7rem 1rem", fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>{d.code}</td>
                  <td style={{ padding: "0.7rem 1rem" }}>{formatValue(d, currency)}</td>
                  <td style={{ padding: "0.7rem 1rem", color: "var(--cmx-muted, rgba(240,242,255,0.55))" }}>{d.usedCount}{d.usageLimit ? ` / ${d.usageLimit}` : ""}</td>
                  <td style={{ padding: "0.7rem 1rem", color: "var(--cmx-muted, rgba(240,242,255,0.55))" }}>{d.expiresAt ? new Date(d.expiresAt).toLocaleDateString() : "Never"}</td>
                  <td style={{ padding: "0.7rem 1rem" }}>
                    <span style={{ fontSize: "0.7rem", fontWeight: 700, color: d.active ? "var(--cmx-success, #34d399)" : "var(--cmx-muted, rgba(240,242,255,0.4))", background: d.active ? "color-mix(in srgb, var(--cmx-success, rgb(52,211,153)) 12%, transparent)" : "color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 6%, transparent)", padding: "2px 8px", borderRadius: 6 }}>
                      {d.active ? "ACTIVE" : "INACTIVE"}
                    </span>
                  </td>
                  <td style={{ padding: "0.7rem 1rem", display: "flex", gap: "0.5rem" }}>
                    <button type="button" onClick={() => void toggleActive(d)} style={{ background: "none", border: "none", color: "var(--cmx-accent, var(--brand))", cursor: "pointer", fontSize: "0.78rem", fontFamily: "inherit" }}>
                      {d.active ? "Deactivate" : "Activate"}
                    </button>
                    <button type="button" onClick={() => void handleDelete(d)} style={{ background: "none", border: "none", color: "var(--cmx-danger, #f87171)", cursor: "pointer", fontSize: "0.78rem", fontFamily: "inherit" }}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <div
          role="dialog" aria-modal="true"
          style={{ position: "fixed", inset: 0, zIndex: 60, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.7)", padding: "1rem" }}
          onClick={(e) => { if (e.target === e.currentTarget) setModalOpen(false); }}
        >
          <div style={{ width: "min(100%,420px)", background: "var(--cmx-surface, #0d0f1a)", border: "1px solid color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 12%, transparent)", borderRadius: 20, padding: "1.75rem" }}>
            <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.15rem", fontWeight: 800, color: "var(--cmx-text, #f0f2ff)", marginBottom: "1.25rem" }}>New Discount Code</h2>

            <div style={{ display: "grid", gap: "1rem" }}>
              <FieldLabel label="Code">
                <input type="text" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="WELCOME10" style={{ ...inputStyle, fontFamily: "ui-monospace, monospace" }} />
              </FieldLabel>

              <div style={{ display: "flex", gap: "0.5rem" }}>
                {(["PERCENT", "FIXED"] as const).map((t) => (
                  <button
                    key={t} type="button" onClick={() => setType(t)}
                    style={{
                      flex: 1, padding: "0.55rem", borderRadius: 9, cursor: "pointer", fontFamily: "inherit",
                      border: type === t ? "1.5px solid var(--cmx-brand, var(--brand))" : "1px solid color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 10%, transparent)",
                      background: type === t ? "var(--cmx-brand-subtle, var(--brand-subtle))" : "color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 3%, transparent)",
                      color: type === t ? "var(--cmx-accent, var(--brand))" : "var(--cmx-muted, rgba(240,242,255,0.6))", fontWeight: 600, fontSize: "0.82rem",
                    }}
                  >
                    {t === "PERCENT" ? "% off" : `${currencySymbol} off`}
                  </button>
                ))}
              </div>

              <FieldLabel label={type === "PERCENT" ? "Percent off" : `Amount off (${currencySymbol})`}>
                <input type="number" value={value} onChange={(e) => setValue(e.target.value)} placeholder={type === "PERCENT" ? "10" : "1000"} style={inputStyle} />
              </FieldLabel>

              <FieldLabel label="Expires (optional)">
                <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} style={inputStyle} />
              </FieldLabel>

              <FieldLabel label="Usage limit (optional)">
                <input type="number" value={usageLimit} onChange={(e) => setUsageLimit(e.target.value)} placeholder="Unlimited" style={inputStyle} />
              </FieldLabel>

              {error && <GateOrError error={error}><p style={{ fontSize: "0.82rem", color: "var(--cmx-danger, #f87171)" }}>{error}</p></GateOrError>}

              <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
                <button type="button" onClick={() => setModalOpen(false)} style={{ padding: "0.6rem 1.1rem", borderRadius: 9, border: "1px solid color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 10%, transparent)", background: "transparent", color: "var(--cmx-muted, rgba(240,242,255,0.65))", cursor: "pointer", fontFamily: "inherit", fontSize: "0.85rem", fontWeight: 600 }}>
                  Cancel
                </button>
                <button
                  type="button" onClick={() => void handleCreate()} disabled={saving}
                  style={{ padding: "0.6rem 1.4rem", borderRadius: 9, border: "none", background: "linear-gradient(135deg,var(--brand),var(--cmx-brand-deep, var(--brand-deep)))", color: "var(--cmx-on-brand, #fff)", cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1, fontFamily: "inherit", fontSize: "0.85rem", fontWeight: 700 }}
                >
                  {saving ? "Creating…" : "Create code"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
