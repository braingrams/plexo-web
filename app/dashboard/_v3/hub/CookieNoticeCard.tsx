"use client";

import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import { useEffect, useState } from "react";
import { Cookie } from "lucide-react";
import { Button, Card, CardHeader, Input, Notice, SegmentedControl, Textarea } from "../ui";
import { DEFAULT_BRAND_TOKENS } from "@/lib/brandTokens";

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

  const defaultBrandHex = DEFAULT_BRAND_TOKENS.light["color-brand-primary"];
  const accent = s.accentColor ?? "var(--plx-brand)";
  const on = !s.accentColor ? "var(--plx-on-brand)" : (() => { const n = parseInt(s.accentColor.slice(1), 16); return ((n >> 16) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) > 150 ? "var(--plx-text)" : "var(--plx-inverse)"; })();
  return (
    <Card>
      <CardHeader title="Cookie notice" description="Visitors in Europe will see a small cookie notice before we count them. That's the law." />
      <div className="plx-form">
        <label className="plx-toggle" style={{ alignItems: "center", width: "100%", paddingBottom: s.enabled ? 16 : 0, borderBottom: s.enabled ? "1px solid var(--plx-border)" : "none" }}>
          <span className="plx-small" style={{ maxWidth: 540 }}>
            <b style={{ fontSize: 14, display: "block", color: "var(--plx-text)", marginBottom: 4 }}>
              Show the notice to visitors who need it
            </b>
            Europe, the UK, Switzerland and Brazil. Nobody else sees it, and counting starts straight away for them. If someone says no, they are not counted.
          </span>
          <input type="checkbox" className="plx-switch" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} aria-label="Show the cookie notice" />
        </label>
        {!s.enabled ? <Notice kind="warning" title="Careful">With the notice off, visitors in Europe are counted without being asked. Most countries there require asking first.</Notice> : null}

        {s.enabled ? (
          <>
            <Textarea label="What it says" value={s.message} maxLength={240} rows={2} onChange={(e) => set({ message: e.target.value })} help="Keep it short and kind." />
            
            <div className="plx-form__two">
              <Input label="Yes button" value={s.acceptLabel} maxLength={24} onChange={(e) => set({ acceptLabel: e.target.value })} />
              <Input label="No button" value={s.declineLabel} maxLength={24} onChange={(e) => set({ declineLabel: e.target.value })} />
            </div>

            <div className="plx-form__two" style={{ alignItems: "flex-start" }}>
              <SegmentedControl<"bar" | "card">
                label="Where it appears"
                value={s.position}
                onChange={(position) => set({ position })}
                options={[
                  { value: "bar", label: "Bar along the bottom" },
                  { value: "card", label: "Small card in the corner" },
                ]}
              />

              <div className="plx-field">
                <span className="plx-field__label">Button colour</span>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", minHeight: 40 }}>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <input
                      id="plx-cookie-colour"
                      type="color"
                      value={s.accentColor || defaultBrandHex}
                      onChange={(e) => set({ accentColor: e.target.value })}
                      style={{
                        width: 44,
                        height: 38,
                        padding: 2,
                        borderRadius: 8,
                        border: "1px solid var(--plx-border)",
                        background: "var(--plx-surface)",
                        cursor: "pointer",
                      }}
                    />
                    <span className="plx-small" style={{ color: "var(--plx-muted)", fontWeight: 600 }}>
                      {s.accentColor ? s.accentColor.toUpperCase() : "Brand colour"}
                    </span>
                  </label>
                  {s.accentColor ? (
                    <Button size="sm" variant="secondary" onClick={() => set({ accentColor: null })}>
                      Use brand colour
                    </Button>
                  ) : null}
                </div>
                <p className="plx-field__help">
                  {s.accentColor ? "Custom colour chosen for notice buttons." : "Following your site's default brand colour."}
                </p>
              </div>
            </div>

            <div aria-label="Preview of the notice" style={{ width: "100%", border: "1px dashed var(--plx-border)", borderRadius: "var(--plx-radius-card)", padding: 18, background: "var(--plx-elevated)" }}>
              <p className="plx-small" style={{ marginBottom: 10, fontWeight: 600, color: "var(--plx-muted)" }}>This is what visitors in Europe see:</p>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", background: "var(--plx-surface)", color: "var(--plx-text)", border: "1px solid var(--plx-border)", borderRadius: "var(--plx-radius-card)", padding: "14px 18px", maxWidth: s.position === "card" ? 360 : "none", flexDirection: s.position === "card" ? "column" : "row" } as React.CSSProperties}>
                <span style={{ flex: "1 1 220px", fontSize: 14, lineHeight: 1.5 }}>{s.message}</span>
                <span style={{ display: "flex", gap: 8, flexShrink: 0, marginTop: s.position === "card" ? 8 : 0 }}>
                  <span style={{ border: `1.5px solid ${accent}`, borderRadius: 8, padding: "7px 14px", fontWeight: 600, fontSize: 13 }}>{s.declineLabel}</span>
                  <span style={{ background: accent, color: on, border: `1.5px solid ${accent}`, borderRadius: 8, padding: "7px 14px", fontWeight: 600, fontSize: 13 }}>{s.acceptLabel}</span>
                </span>
              </div>
              <p className="plx-small" style={{ marginTop: 10, color: "var(--plx-muted)" }}>After they choose, a small &quot;Change cookie settings&quot; button stays in the corner so they can change their mind.</p>
            </div>
          </>
        ) : null}

        {error ? <GateOrError error={error}><Notice kind="error" title="Not saved">{error}</Notice></GateOrError> : null}
        
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginTop: 4 }}>
          <Button loading={busy} variant={dirty ? "primary" : "secondary"} onClick={save}>
            Save cookie notice
          </Button>
          {done && !dirty ? (
            <span className="plx-small" role="status" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--plx-success)", fontWeight: 600 }}>
              <Cookie size={14} aria-hidden /> Saved. It shows on your site within a minute.
            </span>
          ) : dirty ? (
            <span className="plx-small" style={{ color: "var(--plx-muted)" }}>Unsaved changes</span>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
