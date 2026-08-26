"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const PANEL: React.CSSProperties = { maxWidth: 640, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "1.5rem", background: "rgba(255,255,255,0.02)" };

type Warning = { title: string; detail: string };

export function TransferDetailClient({
  id,
  siteName,
  fromName,
  fromEmail,
  fromOrgName,
  toEmail,
  status,
  createdAt,
  expiresAt,
  isRecipient,
  sessionEmail,
  initialWarnings,
}: {
  id: string;
  siteName: string;
  fromName: string;
  fromEmail: string;
  fromOrgName: string;
  toEmail: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  isRecipient: boolean;
  sessionEmail: string;
  initialWarnings: Warning[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<Warning[] | null>(null);
  const [result, setResult] = useState<"ACCEPTED" | "DECLINED" | null>(null);

  async function respond(action: "accept" | "decline", acknowledgeWarnings = false) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/site-transfers/${id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, acknowledgeWarnings }),
      });
      const data = await res.json();
      if (res.status === 409 && data.requiresAcknowledgement) {
        setWarnings(data.warnings);
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Failed to respond to this transfer.");
      setResult(data.status);
      if (data.status === "ACCEPTED" && data.templateId) {
        setTimeout(() => router.push(`/dashboard/templates/${data.templateId}`), 1800);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to respond to this transfer.");
    } finally {
      setBusy(false);
    }
  }

  if (!isRecipient) {
    return (
      <div style={PANEL}>
        <h1 style={{ fontSize: "1.2rem", fontWeight: 600, color: "#f0f2ff", margin: "0 0 0.5rem" }}>{siteName}</h1>
        <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.55)", lineHeight: 1.6 }}>
          This transfer was sent to <strong style={{ color: "#f0f2ff" }}>{toEmail}</strong>, not {sessionEmail}. Log in as that address to respond to it.
        </p>
      </div>
    );
  }

  if (status !== "PENDING" || result) {
    const finalStatus = result ?? status;
    return (
      <div style={PANEL}>
        <h1 style={{ fontSize: "1.2rem", fontWeight: 600, color: "#f0f2ff", margin: "0 0 0.5rem" }}>{siteName}</h1>
        <p style={{ fontSize: "0.85rem", color: finalStatus === "ACCEPTED" ? "#34d399" : "rgba(240,242,255,0.55)" }}>
          {finalStatus === "ACCEPTED" ? "Accepted — this site is now yours. Redirecting to the editor…" : `This transfer is ${finalStatus.toLowerCase()}.`}
        </p>
      </div>
    );
  }

  return (
    <div style={PANEL}>
      <h1 style={{ fontSize: "1.2rem", fontWeight: 600, color: "#f0f2ff", margin: "0 0 0.5rem" }}>{siteName}</h1>
      <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.55)", lineHeight: 1.6, marginBottom: "1.25rem" }}>
        <strong style={{ color: "#f0f2ff" }}>{fromName}</strong> ({fromEmail}) from <strong style={{ color: "#f0f2ff" }}>{fromOrgName}</strong> wants
        to transfer full ownership of this site to your account — every page, and any Commerce catalog/orders it has. Offer sent{" "}
        {new Date(createdAt).toLocaleDateString()}, expires {new Date(expiresAt).toLocaleDateString()}.
      </p>

      {warnings && warnings.length > 0 && (
        <div style={{ marginBottom: "1.25rem" }}>
          <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#fbbf24", marginBottom: "0.5rem" }}>
            {warnings.length} thing{warnings.length === 1 ? "" : "s"} may not work correctly on your plan:
          </div>
          {warnings.map((w, i) => (
            <div key={i} style={{ background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: 9, padding: "0.7rem 0.9rem", marginBottom: "0.5rem" }}>
              <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "#f0f2ff" }}>{w.title}</div>
              <div style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.6)", marginTop: 2, lineHeight: 1.5 }}>{w.detail}</div>
            </div>
          ))}
          <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.5)", marginTop: "0.5rem" }}>
            The site transfers intact either way — these are things to be aware of, not blockers.
          </p>
        </div>
      )}

      {error && <p style={{ fontSize: "0.82rem", color: "#f87171", marginBottom: "1rem" }}>{error}</p>}

      <div style={{ display: "flex", gap: "0.75rem" }}>
        <button
          type="button"
          onClick={() => void respond("accept", warnings !== null)}
          disabled={busy}
          style={{ padding: "0.6rem 1.2rem", borderRadius: 9, border: "none", background: "linear-gradient(135deg,var(--brand),var(--brand-deep))", color: "#fff", fontSize: "0.85rem", fontWeight: 700, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.7 : 1, fontFamily: "inherit" }}
        >
          {busy ? "Working…" : warnings ? "Accept anyway" : "Accept transfer"}
        </button>
        <button
          type="button"
          onClick={() => void respond("decline")}
          disabled={busy}
          style={{ padding: "0.6rem 1.2rem", borderRadius: 9, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "rgba(240,242,255,0.6)", fontSize: "0.85rem", fontWeight: 600, cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit" }}
        >
          Decline
        </button>
      </div>
    </div>
  );
}
