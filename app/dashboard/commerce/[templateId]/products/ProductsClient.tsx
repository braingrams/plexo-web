"use client";

import { useMemo, useState } from "react";

export type ProductSummary = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  kind: "PHYSICAL" | "SERVICE";
  priceMinor: number;
  currency: string;
  stockQuantity: number | null;
  durationMinutes: number | null;
  imageUrl: string | null;
  galleryImageUrls: string[];
  active: boolean;
  category: { id: string; name: string } | null;
  createdAt: string;
};

function formatNaira(minor: number): string {
  return `₦${(minor / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type FormState = {
  id: string | null;
  name: string;
  description: string;
  kind: "PHYSICAL" | "SERVICE";
  priceNaira: string;
  stockQuantity: string;
  durationMinutes: string;
  imageUrl: string;
  galleryImageUrls: string[];
  category: string;
  active: boolean;
  relatedProductIds: string[];
};

const EMPTY_FORM: FormState = {
  id: null,
  name: "",
  description: "",
  kind: "PHYSICAL",
  priceNaira: "",
  stockQuantity: "",
  durationMinutes: "60",
  imageUrl: "",
  galleryImageUrls: [],
  category: "",
  active: true,
  relatedProductIds: [],
};

export function ProductsClient({ templateId, initialProducts }: { templateId: string; initialProducts: ProductSummary[] }) {
  const [products, setProducts] = useState<ProductSummary[]>(initialProducts);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProductSummary | null>(null);

  const apiBase = `/api/v1/commerce/${templateId}/products`;

  function openCreate() {
    setForm(EMPTY_FORM);
    setError(null);
    setModalOpen(true);
  }

  async function openEdit(product: ProductSummary) {
    setError(null);
    setModalOpen(true);
    setForm({
      id: product.id,
      name: product.name,
      description: product.description ?? "",
      kind: product.kind,
      priceNaira: String(product.priceMinor / 100),
      stockQuantity: product.stockQuantity !== null ? String(product.stockQuantity) : "",
      durationMinutes: product.durationMinutes !== null ? String(product.durationMinutes) : "60",
      imageUrl: product.imageUrl ?? "",
      galleryImageUrls: product.galleryImageUrls,
      category: product.category?.name ?? "",
      active: product.active,
      relatedProductIds: [],
    });
    // relatedProductIds isn't on the list payload — fetch the full record for the modal.
    try {
      const res = await fetch(`${apiBase}/${product.id}`);
      if (res.ok) {
        const data = await res.json();
        setForm((prev) => ({ ...prev, relatedProductIds: data.product.relatedProductIds ?? [] }));
      }
    } catch {
      // non-fatal — related products just won't be pre-checked
    }
  }

  async function handleUpload(file: File, target: "main" | "gallery") {
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/v1/media/upload", { method: "POST", body });
      if (!res.ok) throw new Error("Upload failed.");
      const { url } = await res.json();
      if (target === "main") {
        setForm((prev) => ({ ...prev, imageUrl: url }));
      } else {
        setForm((prev) => ({ ...prev, galleryImageUrls: [...prev.galleryImageUrls, url] }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }
    const priceNaira = Number(form.priceNaira);
    if (!Number.isFinite(priceNaira) || priceNaira < 0) {
      setError("Enter a valid price.");
      return;
    }

    setSaving(true);
    setError(null);

    const payload = {
      name: form.name,
      description: form.description || null,
      kind: form.kind,
      priceMinor: Math.round(priceNaira * 100),
      stockQuantity: form.kind === "PHYSICAL" ? Number(form.stockQuantity) || 0 : undefined,
      durationMinutes: form.kind === "SERVICE" ? Number(form.durationMinutes) || 60 : undefined,
      imageUrl: form.imageUrl || null,
      galleryImageUrls: form.galleryImageUrls,
      category: form.category || null,
      active: form.active,
      relatedProductIds: form.relatedProductIds,
    };

    try {
      const res = await fetch(form.id ? `${apiBase}/${form.id}` : apiBase, {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save product.");

      const saved = data.product;
      const summary: ProductSummary = {
        id: saved.id,
        name: saved.name,
        slug: saved.slug,
        description: saved.description,
        kind: saved.kind,
        priceMinor: saved.priceMinor,
        currency: saved.currency,
        stockQuantity: saved.stockQuantity,
        durationMinutes: saved.durationMinutes,
        imageUrl: saved.imageUrl,
        galleryImageUrls: Array.isArray(saved.galleryImageUrls) ? saved.galleryImageUrls : [],
        active: saved.active,
        category: saved.category ?? (form.category ? { id: "", name: form.category } : null),
        createdAt: saved.createdAt ?? new Date().toISOString(),
      };

      setProducts((prev) => (form.id ? prev.map((p) => (p.id === form.id ? summary : p)) : [summary, ...prev]));
      setModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save product.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`${apiBase}/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to deactivate product.");
      setProducts((prev) => prev.map((p) => (p.id === deleteTarget.id ? { ...p, active: false } : p)));
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to deactivate product.");
    }
  }

  const otherProducts = useMemo(() => products.filter((p) => p.id !== form.id), [products, form.id]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ fontSize: "1.35rem", fontWeight: 600, color: "#f0f2ff", margin: 0 }}>Products</h1>
          <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.5)", marginTop: 4 }}>Catalog for this site.</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          style={{
            padding: "0.6rem 1.1rem", borderRadius: 10, border: "none", cursor: "pointer",
            fontSize: "0.85rem", fontWeight: 700, fontFamily: "inherit",
            background: "linear-gradient(135deg,var(--brand),var(--brand-deep))", color: "#fff",
          }}
        >
          + New Product
        </button>
      </div>

      {products.length === 0 ? (
        <div style={{
          padding: "3rem 2rem", textAlign: "center", borderRadius: 14,
          border: "1px dashed rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.02)",
          color: "rgba(240,242,255,0.45)", fontSize: "0.85rem",
        }}>
          No products yet. Create your first one to start selling.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "1rem" }}>
          {products.map((product) => (
            <div key={product.id} style={{
              border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14,
              background: "rgba(255,255,255,0.02)", overflow: "hidden",
              opacity: product.active ? 1 : 0.55,
            }}>
              <div style={{
                height: 140, background: product.imageUrl ? `url(${product.imageUrl}) center/cover` : "rgba(139,92,246,0.08)",
                display: "grid", placeItems: "center",
              }}>
                {!product.imageUrl && <span style={{ color: "rgba(240,242,255,0.25)", fontSize: "0.75rem" }}>No image</span>}
              </div>
              <div style={{ padding: "0.9rem 1rem" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.5rem" }}>
                  <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "#f0f2ff" }}>{product.name}</div>
                  {!product.active && (
                    <span style={{ fontSize: "0.65rem", fontWeight: 700, color: "#f87171", background: "rgba(248,113,113,0.12)", padding: "2px 6px", borderRadius: 6, flexShrink: 0 }}>
                      INACTIVE
                    </span>
                  )}
                </div>
                <div style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.45)", marginTop: 2 }}>
                  {product.category?.name ?? "Uncategorized"} · {product.kind === "PHYSICAL" ? "Product" : "Service"}
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "0.6rem" }}>
                  <span style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--brand)", fontVariantNumeric: "tabular-nums" }}>
                    {formatNaira(product.priceMinor)}
                  </span>
                  <span style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.4)" }}>
                    {product.kind === "PHYSICAL" ? `${product.stockQuantity ?? 0} in stock` : `${product.durationMinutes ?? 0} min`}
                  </span>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.8rem" }}>
                  <button
                    type="button"
                    onClick={() => openEdit(product)}
                    style={{ flex: 1, padding: "0.4rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "#f0f2ff", fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit" }}
                  >
                    Edit
                  </button>
                  {product.active && (
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(product)}
                      style={{ padding: "0.4rem 0.7rem", borderRadius: 8, border: "1px solid rgba(239,68,68,0.25)", background: "rgba(239,68,68,0.08)", color: "#f87171", fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit" }}
                    >
                      Deactivate
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── CREATE/EDIT MODAL ────────────────────────── */}
      {modalOpen && (
        <div
          role="dialog" aria-modal="true"
          style={{ position: "fixed", inset: 0, zIndex: 60, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.7)", padding: "1rem" }}
          onClick={(e) => { if (e.target === e.currentTarget) setModalOpen(false); }}
        >
          <div style={{
            width: "min(100%,560px)", maxHeight: "90vh", overflowY: "auto",
            background: "#0d0f1a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 20, padding: "1.75rem",
          }}>
            <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.2rem", fontWeight: 800, color: "#f0f2ff", marginBottom: "1.25rem" }}>
              {form.id ? "Edit Product" : "New Product"}
            </h2>

            <div style={{ display: "grid", gap: "1rem" }}>
              <label style={{ display: "flex", gap: "0.5rem" }}>
                {(["PHYSICAL", "SERVICE"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, kind: k }))}
                    style={{
                      flex: 1, padding: "0.6rem", borderRadius: 9, cursor: "pointer", fontFamily: "inherit",
                      border: form.kind === k ? "1.5px solid var(--brand)" : "1px solid rgba(255,255,255,0.1)",
                      background: form.kind === k ? "var(--brand-subtle)" : "rgba(255,255,255,0.03)",
                      color: form.kind === k ? "var(--brand)" : "rgba(240,242,255,0.6)",
                      fontWeight: 600, fontSize: "0.85rem",
                    }}
                  >
                    {k === "PHYSICAL" ? "Product" : "Service / Booking"}
                  </button>
                ))}
              </label>

              <FieldLabel label="Name">
                <TextInput value={form.name} onChange={(v) => setForm((p) => ({ ...p, name: v }))} placeholder="Detox Tea (250g)" />
              </FieldLabel>

              <FieldLabel label="Description">
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  rows={3}
                  style={inputStyle}
                />
              </FieldLabel>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <FieldLabel label="Price (₦)">
                  <TextInput value={form.priceNaira} onChange={(v) => setForm((p) => ({ ...p, priceNaira: v }))} placeholder="5000" type="number" />
                </FieldLabel>
                <FieldLabel label="Category">
                  <TextInput value={form.category} onChange={(v) => setForm((p) => ({ ...p, category: v }))} placeholder="Teas" />
                </FieldLabel>
              </div>

              {form.kind === "PHYSICAL" ? (
                <FieldLabel label="Stock quantity">
                  <TextInput value={form.stockQuantity} onChange={(v) => setForm((p) => ({ ...p, stockQuantity: v }))} placeholder="10" type="number" />
                </FieldLabel>
              ) : (
                <FieldLabel label="Duration (minutes)">
                  <TextInput value={form.durationMinutes} onChange={(v) => setForm((p) => ({ ...p, durationMinutes: v }))} placeholder="60" type="number" />
                </FieldLabel>
              )}

              <FieldLabel label="Main image">
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  {form.imageUrl && <img src={form.imageUrl} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover" }} />}
                  <input
                    type="file" accept="image/*" disabled={uploading}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f, "main"); }}
                    style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.6)" }}
                  />
                </div>
              </FieldLabel>

              <FieldLabel label="Gallery images">
                <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
                  {form.galleryImageUrls.map((url, i) => (
                    <div key={i} style={{ position: "relative" }}>
                      <img src={url} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover" }} />
                      <button
                        type="button"
                        onClick={() => setForm((p) => ({ ...p, galleryImageUrls: p.galleryImageUrls.filter((_, idx) => idx !== i) }))}
                        style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: "50%", background: "#ef4444", color: "#fff", border: "none", cursor: "pointer", fontSize: "0.7rem", lineHeight: 1 }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <input
                  type="file" accept="image/*" disabled={uploading}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f, "gallery"); }}
                  style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.6)" }}
                />
              </FieldLabel>

              {otherProducts.length > 0 && (
                <FieldLabel label="Frequently bought together">
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", maxHeight: 140, overflowY: "auto" }}>
                    {otherProducts.map((p) => (
                      <label key={p.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.82rem", color: "rgba(240,242,255,0.75)" }}>
                        <input
                          type="checkbox"
                          checked={form.relatedProductIds.includes(p.id)}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              relatedProductIds: e.target.checked
                                ? [...prev.relatedProductIds, p.id]
                                : prev.relatedProductIds.filter((id) => id !== p.id),
                            }))
                          }
                        />
                        {p.name}
                      </label>
                    ))}
                  </div>
                </FieldLabel>
              )}

              {error && <p style={{ fontSize: "0.82rem", color: "#f87171" }}>{error}</p>}

              <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end", marginTop: "0.5rem" }}>
                <button type="button" onClick={() => setModalOpen(false)} style={{ padding: "0.6rem 1.1rem", borderRadius: 9, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "rgba(240,242,255,0.65)", cursor: "pointer", fontFamily: "inherit", fontSize: "0.85rem", fontWeight: 600 }}>
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving}
                  style={{
                    padding: "0.6rem 1.4rem", borderRadius: 9, border: "none",
                    background: "linear-gradient(135deg,var(--brand),var(--brand-deep))", color: "#fff",
                    cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1,
                    fontFamily: "inherit", fontSize: "0.85rem", fontWeight: 700,
                  }}
                >
                  {saving ? "Saving…" : form.id ? "Save changes" : "Create product"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── DEACTIVATE CONFIRM ────────────────────────── */}
      {deleteTarget && (
        <div
          role="dialog" aria-modal="true"
          style={{ position: "fixed", inset: 0, zIndex: 60, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.75)", padding: "1rem" }}
          onClick={(e) => { if (e.target === e.currentTarget) setDeleteTarget(null); }}
        >
          <div style={{ width: "min(100%,420px)", background: "#0d0f1a", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 18, padding: "1.5rem" }}>
            <h2 style={{ fontSize: "1.05rem", fontWeight: 700, color: "#f0f2ff", marginBottom: "0.5rem" }}>
              Deactivate &quot;{deleteTarget.name}&quot;?
            </h2>
            <p style={{ fontSize: "0.82rem", color: "rgba(240,242,255,0.55)", marginBottom: "1.25rem" }}>
              It'll stop appearing in the storefront but its order history is kept.
            </p>
            <div style={{ display: "flex", gap: "0.6rem", justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setDeleteTarget(null)} style={{ padding: "0.55rem 1rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "#f0f2ff", cursor: "pointer", fontFamily: "inherit", fontSize: "0.82rem" }}>
                Cancel
              </button>
              <button type="button" onClick={() => void handleDelete()} style={{ padding: "0.55rem 1rem", borderRadius: 8, border: "none", background: "#dc2626", color: "#fff", cursor: "pointer", fontFamily: "inherit", fontSize: "0.82rem", fontWeight: 700 }}>
                Deactivate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 9, color: "#f0f2ff", padding: "0.55rem 0.7rem", fontSize: "0.85rem",
  outline: "none", fontFamily: "inherit", resize: "vertical",
};

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#c5cbe8", marginBottom: "0.35rem" }}>{label}</span>
      {children}
    </label>
  );
}

function TextInput({ value, onChange, placeholder, type = "text" }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={inputStyle}
    />
  );
}
