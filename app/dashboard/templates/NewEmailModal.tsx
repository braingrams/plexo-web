"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { NewFromMarketplace } from "./NewFromMarketplace";

/**
 * Classic dashboard: a small "New email" dialog. Name it and start blank, or pick a ready-made
 * design. Creates through POST /api/templates { name, kind: "EMAIL" }, the same call the new dashboard makes.
 */
export function NewEmailModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<"start" | "design">("start");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createBlank() {
    if (!name.trim()) {
      setError("Give your email a name first, like “Welcome email”.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), kind: "EMAIL" }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "We couldn't make your email. Please try again.");
      router.push(`/dashboard/templates/${data.template.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't make your email. Please try again.");
      setBusy(false);
    }
  }

  const btn = { padding: "0.6rem 1.2rem", borderRadius: 10, fontSize: "0.85rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" } as const;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-email-title"
      style={{ position: "fixed", inset: 0, zIndex: 50, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", padding: "1rem" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: "min(100%,480px)", background: "#0d0f1a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 20, padding: "1.75rem", boxShadow: "0 30px 100px rgba(0,0,0,0.8)" }}>
        <h2 id="new-email-title" style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.25rem", fontWeight: 800, color: "#f0f2ff", margin: "0 0 1rem" }}>
          {mode === "start" ? "New email" : "Pick a ready-made design"}
        </h2>
        {mode === "start" ? (
          <>
            <label htmlFor="new-email-name" style={{ display: "block", fontSize: "0.8rem", color: "rgba(240,242,255,0.6)", marginBottom: "0.4rem" }}>What is this email for?</label>
            <input
              id="new-email-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void createBlank(); }}
              placeholder="Welcome email"
              style={{ width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, color: "#f0f2ff", padding: "0.65rem 0.9rem", fontSize: "0.875rem", outline: "none", fontFamily: "inherit" }}
            />
            {error && <p role="alert" style={{ fontSize: "0.8rem", color: "#f87171", marginTop: "0.6rem" }}>{error}</p>}
            <div style={{ display: "flex", gap: "0.6rem", justifyContent: "space-between", flexWrap: "wrap", marginTop: "1.25rem" }}>
              <button type="button" onClick={() => setMode("design")} style={{ ...btn, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "#f0f2ff" }}>
                Pick a ready-made design
              </button>
              <button type="button" disabled={busy} onClick={() => void createBlank()} style={{ ...btn, border: "none", color: "#fff", background: "linear-gradient(135deg,var(--brand),var(--brand-deep))", opacity: busy ? 0.7 : 1 }}>
                {busy ? "Making it…" : "Start blank"}
              </button>
            </div>
          </>
        ) : (
          <>
            <NewFromMarketplace kind="EMAIL" onClose={onClose} />
            <button type="button" onClick={() => setMode("start")} style={{ ...btn, marginTop: "1rem", border: "none", background: "none", color: "rgba(240,242,255,0.6)", padding: 0 }}>
              ← Back
            </button>
          </>
        )}
        <div style={{ marginTop: "1rem", textAlign: "right" }}>
          <button type="button" onClick={onClose} style={{ ...btn, border: "none", background: "none", color: "rgba(240,242,255,0.5)", padding: 0, fontWeight: 500 }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
