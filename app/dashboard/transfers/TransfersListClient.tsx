"use client";

import Link from "next/link";

const PANEL: React.CSSProperties = { border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "1rem 1.25rem", marginBottom: "0.75rem", background: "rgba(255,255,255,0.02)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" };

type Incoming = { id: string; siteName: string; fromName: string; fromOrgName: string; createdAt: string; expiresAt: string };
type Outgoing = { id: string; templateId: string; siteName: string; toEmail: string; createdAt: string };

export function TransfersListClient({ incoming, outgoing }: { incoming: Incoming[]; outgoing: Outgoing[] }) {
  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: "1.35rem", fontWeight: 600, color: "#f0f2ff", margin: "0 0 0.25rem" }}>Site Transfers</h1>
      <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.5)", marginBottom: "1.75rem" }}>
        Sites offered to you, and sites you've offered to someone else.
      </p>

      <h2 style={{ fontSize: "0.85rem", fontWeight: 700, color: "rgba(240,242,255,0.6)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.75rem" }}>
        Offered to you {incoming.length > 0 && `(${incoming.length})`}
      </h2>
      {incoming.length === 0 ? (
        <div style={{ fontSize: "0.82rem", color: "rgba(240,242,255,0.4)", marginBottom: "1.75rem" }}>Nothing pending.</div>
      ) : (
        <div style={{ marginBottom: "1.75rem" }}>
          {incoming.map((t) => (
            <div key={t.id} style={PANEL}>
              <div>
                <div style={{ fontSize: "0.88rem", fontWeight: 600, color: "#f0f2ff" }}>{t.siteName}</div>
                <div style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.5)" }}>
                  From {t.fromName} ({t.fromOrgName}) · expires {new Date(t.expiresAt).toLocaleDateString()}
                </div>
              </div>
              <Link
                href={`/dashboard/transfers/${t.id}`}
                style={{ padding: "0.5rem 1rem", borderRadius: 8, border: "none", background: "linear-gradient(135deg,var(--brand),var(--brand-deep))", color: "#fff", fontSize: "0.8rem", fontWeight: 700, textDecoration: "none", flexShrink: 0 }}
              >
                Review
              </Link>
            </div>
          ))}
        </div>
      )}

      <h2 style={{ fontSize: "0.85rem", fontWeight: 700, color: "rgba(240,242,255,0.6)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.75rem" }}>
        Sent by you {outgoing.length > 0 && `(${outgoing.length})`}
      </h2>
      {outgoing.length === 0 ? (
        <div style={{ fontSize: "0.82rem", color: "rgba(240,242,255,0.4)" }}>Nothing pending.</div>
      ) : (
        outgoing.map((t) => (
          <div key={t.id} style={PANEL}>
            <div>
              <div style={{ fontSize: "0.88rem", fontWeight: 600, color: "#f0f2ff" }}>{t.siteName}</div>
              <div style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.5)" }}>To {t.toEmail} · sent {new Date(t.createdAt).toLocaleDateString()}</div>
            </div>
            <Link href={`/dashboard/templates/${t.templateId}/transfer`} style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.5)" }}>
              Manage →
            </Link>
          </div>
        ))
      )}
    </div>
  );
}
