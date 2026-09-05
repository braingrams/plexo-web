"use client";

import Link from "next/link";
import { useState } from "react";

function StatusPill({ enabled }: { enabled: boolean }) {
  const color = enabled ? "#34d399" : "#fbbf24";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "0.3rem", padding: "0.12rem 0.5rem", borderRadius: 999,
      fontSize: "0.66rem", fontWeight: 700, letterSpacing: "0.03em", textTransform: "uppercase",
      background: enabled ? "rgba(52,211,153,0.14)" : "rgba(251,191,36,0.14)", color,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: color }} />
      {enabled ? "Live" : "Draft"}
    </span>
  );
}

const linkButtonStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.5rem 0.85rem", borderRadius: 9,
  fontSize: "0.8rem", fontWeight: 600, color: "rgba(240,242,255,0.7)",
  background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", cursor: "pointer", textDecoration: "none",
};

/**
 * Funnel identity header. "Edit design" and "Connect a domain" now do exactly what they
 * say — a funnel's own Template page renders the real signup form via the
 * `data-plexo-lms-signup` marker (pre-seeded on every new funnel, see
 * lib/lms/funnelStarterDesign.ts; re-copyable anytime from Funnel Settings' "Embed your
 * signup form"), so both the visual page editor and a connected custom domain serve the
 * genuine visitor experience, not a disconnected placeholder. "Copy funnel link" still
 * hands out the Plexo-hosted `/learn/[templateId]` URL — always works with zero domain
 * setup, same as before — a connected custom domain is an additional, optional way in,
 * not a replacement for it.
 */
export function FunnelSiteHeader({ templateId, name, enabled, domain }: { templateId: string; name: string; enabled: boolean; domain: string | null }) {
  const [copied, setCopied] = useState(false);
  const shareUrl = domain ? `https://${domain}` : null;

  function copyLink(url: string) {
    navigator.clipboard?.writeText(url).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {},
    );
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center" style={{ justifyContent: "space-between", gap: "1rem", marginBottom: "1.4rem", flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
        <span style={{ fontSize: "1.05rem", fontWeight: 700, color: "#f0f2ff" }}>{name}</span>
        <StatusPill enabled={enabled} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
        <Link href={`/dashboard/templates/${templateId}`} style={linkButtonStyle}>
          Edit design
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </Link>

        {enabled && (
          <button type="button" onClick={() => copyLink(`${window.location.origin}/learn/${templateId}`)} style={linkButtonStyle}>
            {copied ? "Copied!" : "Copy funnel link"}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
        )}

        {shareUrl ? (
          <a href={shareUrl} target="_blank" rel="noopener noreferrer" style={linkButtonStyle}>
            Visit domain
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6" /><path d="M10 14L21 3" />
            </svg>
          </a>
        ) : (
          <Link href={`/dashboard/domains?templateId=${templateId}`} style={linkButtonStyle}>
            Connect a domain
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z" />
            </svg>
          </Link>
        )}
      </div>
    </div>
  );
}
