"use client";

import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import { useEffect, useState } from "react";
import { Cookie } from "lucide-react";
import { Button, Card, CardHeader, Input, Notice, SegmentedControl, Textarea } from "../ui";

type Settings = { enabled: boolean; message: string; acceptLabel: string; declineLabel: string; position: "bar" | "card"; accentColor: string | null };

/** The cookie notice for visitors in Europe, the UK, Switzerland and Brazil. On by default; small, friendly options. */
export function CookieNoticeCard({ siteId }: { siteId: string }) {
  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/v1/sites/${siteId}/cookie-notice`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { settings?: Settings } | null) => { if (live && j?.settings) { setS(j.settings); setSaved(j.settings); } })
      .catch(() => undefined);
    return () => { live = false; };
  }, [siteId]);

  if (!s || !saved) return null;
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);
  const set = (patch: Partial<Settings>) => { setS({ ...s, ...patch }); setDone(false); };

  async function save() {
    if (!s) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/sites/${siteId}/cookie-notice`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(s) });
      const json = (await res.json().catch(() => ({}))) as { error?: string; settings?: Settings };
      if (!res.ok || !json.settings) setError(json.error ?? "That didn't save. Please try again.");
      else { setS(json.settings); setSaved(json.settings); setDone(true); }
    } catch {
      setError("We couldn't reach Plexo. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const accent = s.accentColor ?? "var(--plx-brand)";
  const on = !s.accentColor ? "var(--plx-on-brand)" : (() => { const n = parseInt(s.accentColor.slice(1), 16); return ((n >> 16) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) > 150 ? "var(--plx-text)" : "var(--plx-inverse)"; })();
  return (
    <Card>
      <CardHeader title="Cookie notice" description="Visitors in Europe will see a small cookie notice before we count them. That's the law." />
      <div className="plx-hga__connect">
        <label className="plx-toggle" style={{ alignItems: "flex-start" }}>
          <span className="plx-small"><b>Show the notice to visitors who need it</b><br />Europe, the UK, Switzerland and Brazil. Nobody else sees it, and counting starts straight away for them. If someone says no, they are not counted.</span>
          <input type="checkbox" className="plx-switch" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} aria-label="Show the cookie notice" />
        </label>
        {!s.enabled ? <Notice kind="warning" title="Careful">With the notice off, visitors in Europe are counted without being asked. Most countries there require asking first.</Notice> : null}

        {s.enabled ? (
          <>
            <Textarea label="What it says" value={s.message} maxLength={240} rows={2} onChange={(e) => set({ message: e.target.value })} help="Keep it short and kind." />
            <div className="plx-hga__bar" style={{ width: "100%", alignItems: "flex-start" }}>
              <Input label="Yes button" value={s.acceptLabel} maxLength={24} onChange={(e) => set({ acceptLabel: e.target.value })} />
              <Input label="No button" value={s.declineLabel} maxLength={24} onChange={(e) => set({ declineLabel: e.target.value })} />
            </div>
            <div className="plx-hga__bar" style={{ width: "100%", alignItems: "flex-end" }}>
              <SegmentedControl<"bar" | "card"> label="Where it appears" value={s.position} onChange={(position) => set({ position })} options={[{ value: "bar", label: "Bar along the bottom" }, { value: "card", label: "Small card in the corner" }]} />
              <div className="plx-hga__range">
                <label className="plx-small" htmlFor="plx-cookie-colour">Button colour</label>
                <input id="plx-cookie-colour" type="color" value={accent} onChange={(e) => set({ accentColor: e.target.value })} aria-describedby="plx-cookie-colour-help" />
                {s.accentColor ? <Button size="sm" variant="ghost" onClick={() => set({ accentColor: null })}>Use my brand colour</Button> : null}
              </div>
            </div>
            <p id="plx-cookie-colour-help" className="plx-small">{s.accentColor ? "A colour you picked." : "Following your site's brand colour."}</p>

            <div aria-label="Preview of the notice" style={{ width: "100%", border: "1px dashed var(--plx-border)", borderRadius: 12, padding: 16, background: "var(--plx-elevated)" }}>
              <p className="plx-small" style={{ marginBottom: 8 }}>This is what visitors in Europe see:</p>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", background: "var(--plx-surface)", color: "var(--plx-text)", border: "1px solid var(--plx-border)", borderRadius: 12, padding: "12px 14px", maxWidth: s.position === "card" ? 360 : "none", flexDirection: s.position === "card" ? "column" : "row" } as React.CSSProperties}>
                <span style={{ flex: "1 1 220px", fontSize: 14 }}>{s.message}</span>
                <span style={{ display: "flex", gap: 8 }}>
                  <span style={{ border: `2px solid ${accent}`, borderRadius: 10, padding: "7px 14px", fontWeight: 600, fontSize: 14 }}>{s.declineLabel}</span>
                  <span style={{ background: accent, color: on, border: `2px solid ${accent}`, borderRadius: 10, padding: "7px 14px", fontWeight: 600, fontSize: 14 }}>{s.acceptLabel}</span>
                </span>
              </div>
              <p className="plx-small" style={{ marginTop: 8 }}>After they choose, a small &quot;Change cookie settings&quot; button stays in the corner so they can change their mind.</p>
            </div>
          </>
        ) : null}

        {error ? <GateOrError error={error}><Notice kind="error" title="Not saved">{error}</Notice></GateOrError> : null}
        {done && !dirty ? <p className="plx-small" role="status"><Cookie size={14} aria-hidden /> Saved. It shows on your site within a minute.</p> : null}
        <Button loading={busy} disabled={!dirty} onClick={save}>Save cookie notice</Button>
      </div>
    </Card>
  );
}
