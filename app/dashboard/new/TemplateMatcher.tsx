"use client";

import { useState } from "react";
import { Button } from "@/app/dashboard/_v3/ui";
import type { MarketplaceListItem } from "@/lib/marketplace";

type Pick = { id: string; reason: string; template: Omit<MarketplaceListItem, "compiledHtml"> };

/**
 * "What's your website for?" — a sentence or two, and SOL picks the templates that fit, with a reason for each. Free for the
 * owner (no credits). The grid below stays available for anyone who would rather browse.
 */
export function TemplateMatcher({ busyId, onUse }: { busyId: string | null; onUse: (t: MarketplaceListItem) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [picks, setPicks] = useState<Pick[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function find() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/marketplace/templates/recommend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ description: text }) });
      const data = (await res.json().catch(() => ({}))) as { picks?: Pick[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? "We couldn't find a match just now. You can still pick from the list below.");
        return;
      }
      setPicks(data.picks ?? []);
    } catch {
      setError("We couldn't reach Plexo. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Find the right template" style={{ display: "grid", gap: 10, marginBottom: 18, padding: 16, borderRadius: 14, border: "1px solid var(--plx-border, rgba(127,127,127,.25))", background: "var(--plx-surface, transparent)" }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>What is your website for?</h2>
        <p style={{ margin: "4px 0 0", fontSize: 13, opacity: 0.75 }}>Tell us in a sentence and SOL will pick the templates that fit. It&apos;s free.</p>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        maxLength={600}
        placeholder="For example: a bakery in Lagos that takes cake orders, or a church with weekly events"
        aria-label="What is your website for?"
        style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--plx-border, rgba(127,127,127,.3))", background: "transparent", color: "inherit", font: "inherit", resize: "vertical" }}
      />
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Button onClick={() => void find()} loading={busy} disabled={text.trim().length < 8}>Find my best match</Button>
        {picks ? <button type="button" onClick={() => { setPicks(null); setText(""); }} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", opacity: 0.7, font: "inherit", textDecoration: "underline" }}>Clear</button> : null}
      </div>
      {error ? <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--plx-danger, #b42318)" }}>{error}</p> : null}
      {picks && picks.length > 0 ? (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
          {picks.slice(0, 3).map((p, i) => (
            <li key={p.id} style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", padding: "10px 12px", borderRadius: 10, background: i === 0 ? "var(--plx-tint, transparent)" : "transparent", border: "1px solid var(--plx-border, rgba(127,127,127,.2))" }}>
              <span style={{ minWidth: 0 }}>
                <b>{i === 0 ? "Best match: " : ""}{p.template.name}</b>
                <span style={{ display: "block", fontSize: 13, opacity: 0.75 }}>{p.reason}</span>
              </span>
              <Button size="sm" variant={i === 0 ? "primary" : "secondary"} loading={busyId === p.id} onClick={() => onUse(p.template as MarketplaceListItem)}>Use this</Button>
            </li>
          ))}
        </ol>
      ) : null}
      {picks && picks.length === 0 ? <p style={{ margin: 0, fontSize: 13 }}>We couldn&apos;t find a close match, so browse the list below.</p> : null}
    </section>
  );
}
