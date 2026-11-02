"use client";

import { useState } from "react";

type Result = {
  kind: "visual" | "classic" | "html" | "app";
  alreadyThere: boolean;
  live: boolean;
  publishedUrl: string | null;
  editableUrl: string;
  snippet: string;
  warnings: string[];
  message: string;
};

/**
 * One click to sell a product from the site's home page: a buy card goes on the page,
 * visitors pay right there and every purchase becomes an order. No checkout page to build,
 * no codes to paste — the owner can move or restyle the new section in the editor afterwards.
 */
export function SellProductModal({ siteId, product, onClose }: { siteId: string; product: { id: string; name: string }; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState(false);

  async function sell() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/commerce/${siteId}/products/${product.id}/sell`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error || "We couldn't add it to your page. Please try again.");
      else setResult(data);
    } catch {
      setError("We couldn't reach Plexo. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const done = Boolean(result);
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)", zIndex: 9998 }} />
      <div role="dialog" aria-modal="true" style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: "calc(100% - 2rem)", maxWidth: 480, maxHeight: "85vh", overflowY: "auto", background: "rgba(18,16,36,0.98)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.5)", zIndex: 9999, padding: "1.6rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
          <h3 style={{ fontSize: "1.05rem", fontWeight: 800, color: "#f0f2ff", margin: 0 }}>{done ? "Done" : `Sell “${product.name}” on your home page`}</h3>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(240,242,255,0.4)", fontSize: "1.2rem", lineHeight: 1 }}>×</button>
        </div>

        {!done && (
          <>
            <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.65)", margin: 0, lineHeight: 1.6 }}>
              We'll set up your home page to sell it. If the page already has a payment button for this, that button will open the checkout; otherwise we'll add a buy card. Visitors pay right there, and every purchase shows up in your Orders.
            </p>
            {error && <p style={{ fontSize: "0.82rem", color: "#fca5a5", margin: 0, lineHeight: 1.5 }}>{error}</p>}
            <button type="button" onClick={() => void sell()} disabled={busy} style={{ padding: "0.7rem 1rem", borderRadius: 10, fontSize: "0.9rem", fontWeight: 700, border: "none", color: "#fff", background: "linear-gradient(135deg,var(--brand),var(--brand-deep))", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
              {busy ? "Adding it…" : "Add to my home page"}
            </button>
          </>
        )}

        {result && (
          <>
            <p style={{ fontSize: "0.85rem", color: "#86efac", margin: 0, lineHeight: 1.6 }}>{result.message}</p>
            {result.warnings.map((w) => (
              <p key={w} style={{ fontSize: "0.8rem", color: "#fcd34d", margin: 0, lineHeight: 1.5 }}>{w}</p>
            ))}
            {result.kind === "app" && (
              <div style={{ position: "relative" }}>
                <pre style={{ margin: 0, padding: "0.8rem 0.9rem", borderRadius: 10, background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.08)", fontSize: "0.75rem", color: "#c4b5fd", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{result.snippet}</pre>
                <button type="button" onClick={() => navigator.clipboard.writeText(result.snippet).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })} style={{ marginTop: "0.5rem", padding: "0.35rem 0.7rem", borderRadius: 7, fontSize: "0.75rem", fontWeight: 700, border: "1px solid rgba(var(--brand-rgb),0.3)", background: "rgba(var(--brand-rgb),0.12)", color: "var(--brand)", cursor: "pointer" }}>
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            )}
            <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
              {result.publishedUrl && result.live && (
                <a href={result.publishedUrl} target="_blank" rel="noreferrer" style={{ padding: "0.5rem 0.9rem", borderRadius: 9, fontSize: "0.82rem", fontWeight: 700, color: "#fff", textDecoration: "none", background: "linear-gradient(135deg,var(--brand),var(--brand-deep))" }}>View my page</a>
              )}
              <a href={result.editableUrl} style={{ padding: "0.5rem 0.9rem", borderRadius: 9, fontSize: "0.82rem", fontWeight: 600, color: "rgba(240,242,255,0.8)", textDecoration: "none", border: "1px solid rgba(255,255,255,0.12)" }}>
                {result.live ? "Open the editor" : "Review and publish"}
              </a>
            </div>
          </>
        )}
      </div>
    </>
  );
}
