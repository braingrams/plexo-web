"use client";

import { listPageTemplates } from "@charisol/plexo-sdk/v2/compile";

// "Start from a ready-made page" cards, shown wherever a new page is made while new-editor pages
// are on. The choice is just an id passed to the create call as `pageTemplate` ("" = blank page);
// the server builds the page. Every design is already filled with words, so a new page is never empty.

export const BLANK_PAGE_DESIGN = "";

export function PageDesignPicker({ value, onChange, compact }: { value: string; onChange: (id: string) => void; compact?: boolean }) {
  const designs = listPageTemplates();
  const options = [{ id: BLANK_PAGE_DESIGN, name: "Blank page", description: "Start from nothing.", sections: [] as string[] }, ...designs.filter((d) => d.id !== "blank")];
  return (
    <div role="radiogroup" aria-label="Start from" style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${compact ? 120 : 150}px, 1fr))`, gap: 8 }}>
      {options.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id || "blank"}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.id)}
            style={{ textAlign: "left", padding: 8, borderRadius: 10, cursor: "pointer", fontFamily: "inherit", color: "inherit", border: active ? "1.5px solid rgba(var(--brand-rgb),0.6)" : "1px solid rgba(255,255,255,0.1)", background: active ? "var(--brand-subtle)" : "rgba(255,255,255,0.03)" }}
          >
            <span aria-hidden style={{ display: "flex", flexDirection: "column", gap: 3, height: 46, padding: 5, marginBottom: 6, borderRadius: 6, background: "rgba(11,15,25,0.6)", border: o.id ? "1px solid rgba(255,255,255,0.08)" : "1.5px dashed rgba(255,255,255,0.18)", overflow: "hidden" }}>
              {o.sections.slice(0, 5).map((_, i) => (
                <span key={i} style={{ flex: 1, minHeight: 3, borderRadius: 3, background: i === 0 ? "rgba(var(--brand-rgb),0.55)" : "rgba(255,255,255,0.14)" }} />
              ))}
            </span>
            <span style={{ display: "block", fontSize: "0.78rem", fontWeight: 700 }}>{o.name}</span>
            {!compact && <span style={{ display: "block", fontSize: "0.7rem", color: "rgba(240,242,255,0.5)", marginTop: 2, lineHeight: 1.35 }}>{o.description}</span>}
          </button>
        );
      })}
    </div>
  );
}
