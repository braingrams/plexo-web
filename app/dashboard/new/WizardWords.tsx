"use client";

import { useState } from "react";
import { TONES, type ToneId } from "@/lib/brand/brandVoice";

/**
 * A light, skippable "how should your site sound?" step for the new-site wizard: a tagline and up to a few tones.
 * Each change saves by itself (nothing to press), and leaving it empty is fine: it can be filled in later on the Brand page.
 */
export function WizardWords({ siteId }: { siteId: string }) {
  const [tagline, setTagline] = useState("");
  const [tones, setTones] = useState<ToneId[]>([]);
  const [note, setNote] = useState<string | null>(null);

  async function save(patch: { tagline?: string; tones?: ToneId[] }) {
    try {
      const res = await fetch(`/api/v1/sites/${encodeURIComponent(siteId)}/voice`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setNote(res.ok ? "Saved. You can change this any time on your Brand page." : body.error ?? "We couldn't save that just now. You can add it later on your Brand page.");
    } catch {
      setNote("We couldn't save that just now. You can add it later on your Brand page.");
    }
  }
  const toggle = (id: ToneId) => {
    const next = tones.includes(id) ? tones.filter((t) => t !== id) : tones.length >= 4 ? tones : [...tones, id];
    setTones(next);
    void save({ tones: next });
  };

  return (
    <section aria-label="How your site sounds" style={{ margin: "0 0 20px", padding: "14px 0", borderTop: "1px solid var(--border-soft, var(--border))" }}>
      <h3 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 700 }}>How should your site sound? <span style={{ fontWeight: 500, color: "var(--text-faint)" }}>(optional)</span></h3>
      <p style={{ margin: "0 0 10px", fontSize: 12.5, color: "var(--text-muted)" }}>A tagline and a few words about your style help SOL write everything in your voice. Skip it if you like.</p>
      <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, marginBottom: 4 }} htmlFor="wizard-tagline">Tagline</label>
      <input id="wizard-tagline" value={tagline} maxLength={90} placeholder="e.g. Fresh bread, baked slow." onChange={(e) => setTagline(e.target.value)} onBlur={() => tagline.trim() && void save({ tagline })} style={{ width: "100%", padding: "9px 12px", borderRadius: 10, border: "1px solid var(--border)", font: "inherit", background: "var(--bg-surface, transparent)", color: "inherit" }} />
      <div role="group" aria-label="Your style" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
        {TONES.slice(0, 6).map((t) => (
          <button key={t.id} type="button" aria-pressed={tones.includes(t.id)} title={`“${t.example}”`} onClick={() => toggle(t.id)} style={{ padding: "6px 12px", borderRadius: 999, border: `1px solid ${tones.includes(t.id) ? "var(--brand)" : "var(--border)"}`, background: tones.includes(t.id) ? "var(--brand-subtle)" : "transparent", font: "inherit", fontSize: 13, cursor: "pointer", color: "inherit" }}>{t.label}</button>
        ))}
      </div>
      {note ? <p role="status" style={{ margin: "8px 0 0", fontSize: 12, color: "var(--text-muted)" }}>{note}</p> : null}
    </section>
  );
}
