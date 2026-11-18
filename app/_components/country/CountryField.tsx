"use client";

import { useState } from "react";
import { CountrySelect } from "./CountrySelect";
import { T } from "./skin";

/**
 * "Which country are you in?" with its own Save — drop it into any settings screen. Saves through
 * PUT /api/profile/country and says plainly what a change does to prices.
 */
export function CountryField({ initialCountry, guess }: { initialCountry: string | null; guess?: string | null }) {
  const [saved, setSaved] = useState(initialCountry);
  const [value, setValue] = useState<string | null>(initialCountry ?? guess ?? null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = !!value && value !== saved;

  async function save() {
    if (!value) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/profile/country", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ country: value }) });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "We couldn't save that. Please try again.");
      setSaved(value);
      setMessage({ ok: true, text: "Saved. You'll see prices for this country from now on." });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "We couldn't save that. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ fontFamily: T.font }}>
      <label htmlFor="country-field" style={{ display: "block", fontWeight: 700, color: T.text, fontSize: "0.9rem", marginBottom: 4 }}>
        Which country are you in?
      </label>
      <p style={{ margin: "0 0 0.75rem", fontSize: "0.82rem", color: T.muted, lineHeight: 1.5 }}>
        So we show prices in your currency. Changing it only affects future payments. If you already have a plan, it keeps its current price until it renews or ends.
      </p>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 240px", maxWidth: 360 }}>
          <CountrySelect id="country-field" value={value} onChange={(c) => { setValue(c); setMessage(null); }} />
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || busy}
          style={{ background: T.action, color: T.onAction, border: 0, borderRadius: T.radius, padding: "0.8rem 1.4rem", fontWeight: 700, fontSize: "0.9rem", cursor: !dirty || busy ? "not-allowed" : "pointer", opacity: !dirty || busy ? 0.5 : 1, fontFamily: T.font }}
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      {message && (
        <p role="status" style={{ margin: "0.6rem 0 0", fontSize: "0.82rem", color: message.ok ? T.muted : T.danger }}>
          {message.text}
        </p>
      )}
    </div>
  );
}
