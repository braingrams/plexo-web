"use client";

import { switchLabel, useVersionSwitch } from "./VersionUi";

/** "Switch to Version 2" / "Switch back to Version 1" in the classic account menu. Nothing when switching isn't allowed. */
export function ClassicSwitchItems({ onPick, compact }: { onPick?: () => void; compact?: boolean }) {
  const { targets, request } = useVersionSwitch();
  if (targets.length === 0) return null;
  return (
    <>
      {targets.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => {
            onPick?.();
            request(t.id);
          }}
          style={{
            width: "100%", display: "flex", alignItems: "center", gap: "0.6rem", padding: compact ? "0.6rem 0.75rem" : "0.55rem 0.6rem", borderRadius: 10,
            background: "none", border: "none", textAlign: "left", cursor: "pointer", fontSize: "0.82rem", fontWeight: 500, color: "rgba(240,242,255,0.7)",
          }}
        >
          {switchLabel(t)}
        </button>
      ))}
    </>
  );
}

/** Settings -> Profile in the classic dashboard: "Your dashboard". Nothing when switching isn't allowed. */
export function ClassicVersionCard() {
  const { targets, request } = useVersionSwitch();
  if (targets.length === 0) return null;
  return (
    <section style={{ marginTop: 24, padding: 20, borderRadius: 16, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)" }}>
      <h2 style={{ margin: "0 0 6px", fontSize: "1rem", fontWeight: 700, color: "#f0f2ff" }}>Your dashboard</h2>
      <p style={{ margin: "0 0 14px", fontSize: "0.85rem", lineHeight: 1.5, color: "rgba(240,242,255,0.55)" }}>Change how Plexo looks. Everything you&apos;ve made stays exactly as it is.</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {targets.map((t) => (
          <button key={t.id} type="button" onClick={() => request(t.id)} style={{ minHeight: 40, padding: "0 16px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "#f0f2ff", fontWeight: 600, cursor: "pointer" }}>
            {switchLabel(t)}
          </button>
        ))}
      </div>
    </section>
  );
}
