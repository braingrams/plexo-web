"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { TemplateKind } from "@prisma/client";

export type StarterTemplate = {
  id: string;
  name: string;
  kind: TemplateKind;
  category: string | null;
  priceCents: number;
};

type Props = {
  userName: string;
  starterTemplates: StarterTemplate[];
};

const hairline = "rgba(255,255,255,0.09)";
const hairlineSoft = "rgba(255,255,255,0.055)";

// Deterministic accent per card — there's no thumbnail to show for a fresh marketplace
// pick, so this is a category-color cue, not a fabricated screenshot.
const SWATCHES = [
  "linear-gradient(150deg,#312e81,#7c3aed 60%,#c084fc)",
  "linear-gradient(150deg,#0f172a,#0ea5e9 65%,#67e8f9)",
  "linear-gradient(150deg,#134e4a,#10b981 65%,#6ee7b7)",
  "linear-gradient(150deg,#450a0a,#f43f5e 65%,#fda4af)",
];

function kindLabel(kind: TemplateKind): string {
  return kind === "LANDING_PAGE" ? "Landing Page" : "Email";
}

export function OverviewSetup({ userName, starterTemplates }: Props) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleUse(item: StarterTemplate) {
    setError(null);
    if (item.priceCents > 0) {
      router.push(`/marketplace/${item.id}`);
      return;
    }
    setBusyId(item.id);
    try {
      const res = await fetch(`/api/v1/marketplace/templates/${item.id}/use`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to use this template.");
        return;
      }
      router.push(`/dashboard/templates/${data.template.id}`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ color: "var(--text-main)" }}>
      {/* Header */}
      <div style={{ marginBottom: "2.25rem" }}>
        <div style={{ fontSize: "10.5px", fontWeight: 650, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 10 }}>
          Welcome, {userName}
        </div>
        <h1 style={{ margin: "0 0 8px", fontSize: "30px", fontWeight: 700, letterSpacing: "-0.02em" }}>Set up your first site</h1>
        <p style={{ margin: 0, fontSize: "14px", color: "var(--text-muted)", maxWidth: 560 }}>
          Pick a starting point, make it yours, then publish. Most sites go live in a few minutes.
        </p>
      </div>

      {/* Stepper */}
      <div style={{ height: 1, background: hairline }} />
      <div style={{ display: "flex", alignItems: "center", padding: "22px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "13px", fontWeight: 700, color: "var(--brand)" }}>01</span>
          <span style={{ fontSize: "10.5px", fontWeight: 650, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-main)" }}>Start</span>
        </div>
        <div style={{ flex: 1, height: 1, background: "var(--brand)", opacity: 0.35, margin: "0 20px" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "13px", fontWeight: 700, color: "var(--text-faint)" }}>02</span>
          <span style={{ fontSize: "10.5px", fontWeight: 650, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-faint)" }}>Customize</span>
        </div>
        <div style={{ flex: 1, height: 1, background: hairline, margin: "0 20px" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "13px", fontWeight: 700, color: "var(--text-muted)" }}>03</span>
          <span style={{ fontSize: "10.5px", fontWeight: 650, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)" }}>Publish</span>
        </div>
      </div>
      <div style={{ height: 1, background: hairline }} />

      {/* Step 01 — Start */}
      <div style={{ padding: "32px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 20 }}>
          <span style={{ fontSize: "10.5px", fontWeight: 650, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)" }}>
            01 &mdash; Choose a starting point
          </span>
          <span style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--text-muted)" }}>
            or{" "}
            <Link href="/dashboard/templates" style={{ fontWeight: 650, color: "var(--brand)" }}>
              start from a blank canvas
            </Link>
          </span>
        </div>

        {error && (
          <p style={{ fontSize: "12.5px", color: "var(--danger)", marginBottom: 16 }} role="alert">
            {error}
          </p>
        )}

        {starterTemplates.length === 0 ? (
          <p style={{ fontSize: "12.5px", color: "var(--text-faint)" }}>
            No marketplace templates available right now —{" "}
            <Link href="/dashboard/templates" style={{ color: "var(--brand)", fontWeight: 650 }}>
              start from a blank canvas
            </Link>{" "}
            instead.
          </p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20 }}>
            {starterTemplates.map((item, i) => {
              const isFree = item.priceCents === 0;
              const busy = busyId === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void handleUse(item)}
                  disabled={busy}
                  style={{
                    textAlign: "left",
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: busy ? "wait" : "pointer",
                    fontFamily: "inherit",
                    color: "inherit",
                  }}
                >
                  <div
                    style={{
                      height: 76,
                      borderRadius: 8,
                      border: `1px solid ${hairline}`,
                      background: SWATCHES[i % SWATCHES.length],
                      marginBottom: 10,
                    }}
                  />
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: "13px", fontWeight: 650, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item.name}
                      </div>
                      <div style={{ fontSize: "11.5px", color: "var(--text-muted)" }}>{item.category ?? kindLabel(item.kind)}</div>
                    </div>
                    <span style={{ fontSize: "11.5px", fontWeight: 650, color: isFree ? "var(--success)" : "var(--text-muted)", flexShrink: 0, marginLeft: 8 }}>
                      {busy ? "…" : isFree ? "Use →" : `$${(item.priceCents / 100).toFixed(2)}`}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ height: 1, background: hairlineSoft }} />

      {/* Step 02 — Customize */}
      <div style={{ padding: "26px 0", opacity: 0.5 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
          <span style={{ fontSize: "10.5px", fontWeight: 650, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-faint)" }}>
            02 &mdash; Customize
          </span>
          <span style={{ fontSize: "11.5px", color: "var(--text-faint)" }}>Unlocks once you pick a template</span>
        </div>
        <p style={{ margin: 0, fontSize: "13px", color: "var(--text-muted)", maxWidth: 640, lineHeight: 1.6 }}>
          Edit copy and images directly on the page, match your brand colors and fonts, and add or remove pages &mdash; all in the visual editor. No code required.
        </p>
      </div>

      <div style={{ height: 1, background: hairlineSoft }} />

      {/* Step 03 — Publish */}
      <div style={{ padding: "26px 0 0" }}>
        <span style={{ fontSize: "10.5px", fontWeight: 650, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)" }}>
          03 &mdash; Publish
        </span>
        <p style={{ margin: "14px 0 0", fontSize: "13px", color: "var(--text-muted)", maxWidth: 640, lineHeight: 1.6 }}>
          Your site goes live instantly on a free subdomain. Connect a custom domain any time from{" "}
          <Link href="/dashboard/domains">Domains</Link>.
        </p>
      </div>
    </div>
  );
}
