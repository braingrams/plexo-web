"use client";

import { useState } from "react";
import { PageContainer } from "../../../_components/PageContainer";

export type RedirectSummary = {
  fromPath: string;
  toPath: string;
  createdAt: string;
};

const inputStyle: React.CSSProperties = {
  width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 9, color: "#f0f2ff", padding: "0.55rem 0.75rem", fontSize: "0.85rem",
  outline: "none", fontFamily: "inherit",
};

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#c5cbe8", marginBottom: "0.35rem" }}>{label}</span>
      {children}
    </label>
  );
}

export function RedirectsClient({ templateId, initialRedirects }: { templateId: string; initialRedirects: RedirectSummary[] }) {
  const [redirects, setRedirects] = useState(initialRedirects);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingFromPath, setEditingFromPath] = useState<string | null>(null);
  const [fromPath, setFromPath] = useState("");
  const [toPath, setToPath] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiBase = `/api/v1/templates/${templateId}/redirects`;

  // fromPath (e.g. "/blog/old-post") becomes the catch-all URL segments on the [...fromPath]
  // route — encode each segment individually so a space or other special character in a
  // path survives the round trip instead of corrupting the URL.
  function redirectUrl(fromPath: string): string {
    return `${apiBase}/${fromPath.split("/").filter(Boolean).map(encodeURIComponent).join("/")}`;
  }

  function openCreate() {
    setEditingFromPath(null);
    setFromPath("");
    setToPath("");
    setError(null);
    setModalOpen(true);
  }

  function openEdit(redirect: RedirectSummary) {
    setEditingFromPath(redirect.fromPath);
    setFromPath(redirect.fromPath);
    setToPath(redirect.toPath);
    setError(null);
    setModalOpen(true);
  }

  async function handleSave() {
    setError(null);
    if (!editingFromPath && !fromPath.trim().startsWith("/")) {
      setError("From path must start with /.");
      return;
    }
    if (!toPath.trim()) {
      setError("Enter a destination.");
      return;
    }
    setSaving(true);
    try {
      if (editingFromPath) {
        const res = await fetch(redirectUrl(editingFromPath), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toPath }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to update redirect.");
        setRedirects((prev) => prev.map((r) => (r.fromPath === editingFromPath ? { ...r, toPath: data.redirect.toPath } : r)));
      } else {
        const res = await fetch(apiBase, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fromPath, toPath }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to create redirect.");
        setRedirects((prev) => [
          { fromPath: data.redirect.fromPath, toPath: data.redirect.toPath, createdAt: data.redirect.createdAt },
          ...prev,
        ]);
      }
      setModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save redirect.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(redirect: RedirectSummary) {
    if (!confirm(`Delete the redirect from "${redirect.fromPath}"?`)) return;
    const res = await fetch(redirectUrl(redirect.fromPath), { method: "DELETE" });
    if (res.ok) {
      setRedirects((prev) => prev.filter((r) => r.fromPath !== redirect.fromPath));
    }
  }

  return (
    <PageContainer>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#f0f2ff", marginBottom: "0.4rem" }}>Redirects</h1>
          <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.5)", margin: 0 }}>
            Send visitors from an old path on this site to a new one. Takes priority over the site&apos;s own page tree.
          </p>
        </div>
        <button
          type="button" onClick={openCreate}
          style={{ padding: "0.6rem 1.1rem", borderRadius: 10, border: "none", cursor: "pointer", fontSize: "0.85rem", fontWeight: 700, fontFamily: "inherit", background: "linear-gradient(135deg,var(--brand),var(--brand-deep))", color: "#fff", whiteSpace: "nowrap" }}
        >
          + Add redirect
        </button>
      </div>

      {redirects.length === 0 ? (
        <div style={{ padding: "3rem 2rem", textAlign: "center", borderRadius: 14, border: "1px dashed rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.02)", color: "rgba(240,242,255,0.45)", fontSize: "0.85rem" }}>
          No redirects yet.
        </div>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
            <thead>
              <tr style={{ color: "rgba(240,242,255,0.4)", textAlign: "left", background: "rgba(255,255,255,0.02)" }}>
                <th style={{ fontWeight: 500, padding: "0.7rem 1rem" }}>From</th>
                <th style={{ fontWeight: 500, padding: "0.7rem 1rem" }}>To</th>
                <th style={{ fontWeight: 500, padding: "0.7rem 1rem" }}>Created</th>
                <th style={{ fontWeight: 500, padding: "0.7rem 1rem" }}></th>
              </tr>
            </thead>
            <tbody>
              {redirects.map((r) => (
                <tr key={r.fromPath} style={{ borderTop: "1px solid rgba(255,255,255,0.06)", color: "#e2e4f5" }}>
                  <td style={{ padding: "0.7rem 1rem", fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>{r.fromPath}</td>
                  <td style={{ padding: "0.7rem 1rem", fontFamily: "ui-monospace, monospace", color: "rgba(240,242,255,0.75)" }}>{r.toPath}</td>
                  <td style={{ padding: "0.7rem 1rem", color: "rgba(240,242,255,0.55)" }}>{new Date(r.createdAt).toLocaleDateString()}</td>
                  <td style={{ padding: "0.7rem 1rem", display: "flex", gap: "0.5rem" }}>
                    <button type="button" onClick={() => openEdit(r)} style={{ background: "none", border: "none", color: "var(--brand)", cursor: "pointer", fontSize: "0.78rem", fontFamily: "inherit" }}>
                      Edit
                    </button>
                    <button type="button" onClick={() => void handleDelete(r)} style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: "0.78rem", fontFamily: "inherit" }}>
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
          <div style={{ width: "min(100%,420px)", background: "#0d0f1a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 20, padding: "1.75rem" }}>
            <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.15rem", fontWeight: 800, color: "#f0f2ff", marginBottom: "1.25rem" }}>
              {editingFromPath ? "Edit Redirect" : "New Redirect"}
            </h2>

            <div style={{ display: "grid", gap: "1rem" }}>
              <FieldLabel label="From path">
                <input
                  type="text" value={fromPath} onChange={(e) => setFromPath(e.target.value)}
                  placeholder="/old-page" disabled={!!editingFromPath}
                  style={{ ...inputStyle, fontFamily: "ui-monospace, monospace", opacity: editingFromPath ? 0.6 : 1 }}
                />
              </FieldLabel>

              <FieldLabel label="To (relative path or full URL)">
                <input
                  type="text" value={toPath} onChange={(e) => setToPath(e.target.value)}
                  placeholder="/new-page or https://example.com/page"
                  style={{ ...inputStyle, fontFamily: "ui-monospace, monospace" }}
                />
              </FieldLabel>

              {error && <p style={{ fontSize: "0.82rem", color: "#f87171" }}>{error}</p>}

              <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
                <button type="button" onClick={() => setModalOpen(false)} style={{ padding: "0.6rem 1.1rem", borderRadius: 9, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "rgba(240,242,255,0.65)", cursor: "pointer", fontFamily: "inherit", fontSize: "0.85rem", fontWeight: 600 }}>
                  Cancel
                </button>
                <button
                  type="button" onClick={() => void handleSave()} disabled={saving}
                  style={{ padding: "0.6rem 1.4rem", borderRadius: 9, border: "none", background: "linear-gradient(135deg,var(--brand),var(--brand-deep))", color: "#fff", cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1, fontFamily: "inherit", fontSize: "0.85rem", fontWeight: 700 }}
                >
                  {saving ? "Saving…" : editingFromPath ? "Save changes" : "Create redirect"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
