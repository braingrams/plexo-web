"use client";

import { useState } from "react";
import { Toggle } from "@/app/dashboard/_components/Toggle";
import { SettingsActionBar } from "../_components/SettingsActionBar";
import type { CheckoutField, CheckoutFieldType } from "@/lib/commerce/checkoutFields";

const MAX_FIELDS = 20;

const TYPE_LABELS: Record<CheckoutFieldType, string> = {
  text: "Short answer",
  textarea: "Long answer",
  select: "Dropdown",
  date: "Date",
  phone: "Phone number",
};

// Common asks, one click away — so an owner doesn't have to think up the wording.
const SUGGESTIONS: { label: string; type: CheckoutFieldType; placeholder?: string }[] = [
  { label: "Gift message", type: "textarea", placeholder: "Add a note for the recipient" },
  { label: "Preferred delivery date", type: "date" },
  { label: "Nearest landmark", type: "text", placeholder: "e.g. Opposite the filling station" },
  { label: "Alternative phone number", type: "phone" },
  { label: "How did you hear about us?", type: "text" },
];

const inputStyle: React.CSSProperties = {
  width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 9, color: "#f0f2ff", padding: "0.55rem 0.75rem", fontSize: "0.85rem",
  outline: "none", fontFamily: "inherit",
};

type DraftField = CheckoutField & { optionsText: string; key: string };

function toDraft(f: CheckoutField): DraftField {
  return { ...f, optionsText: (f.options ?? []).join("\n"), key: f.id };
}

let draftCounter = 0;
function newDraft(partial: Partial<CheckoutField> = {}): DraftField {
  draftCounter += 1;
  // No id yet — the server assigns one on save (lib/commerce/checkoutFields.ts).
  return { id: "", label: "", type: "text", required: false, optionsText: "", key: `new-${Date.now()}-${draftCounter}`, ...partial };
}

/**
 * Settings → Checkout: extra questions the site owner wants every customer to answer at
 * checkout. Answers land on the order (Orders → Delivery info) and in the owner's
 * bank-transfer email. Saved as the whole list at once — same as every other Settings page.
 */
export function CheckoutSettingsClient({ templateId, initialFields }: { templateId: string; initialFields: CheckoutField[] }) {
  const [fields, setFields] = useState<DraftField[]>(initialFields.map(toDraft));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  function update(key: string, patch: Partial<DraftField>) {
    setFields((prev) => prev.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  }
  function move(index: number, delta: number) {
    setFields((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const payload = fields.map((f) => ({
        id: f.id || undefined,
        label: f.label,
        type: f.type,
        required: f.required,
        placeholder: f.placeholder || undefined,
        options: f.type === "select" ? f.optionsText.split("\n").map((o) => o.trim()).filter(Boolean) : undefined,
      }));
      const res = await fetch(`/api/v1/commerce/${templateId}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkoutFields: payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save checkout questions.");
      setFields((data.settings?.checkoutFields ?? []).map(toDraft));
      setMessage({ kind: "success", text: "Checkout questions saved — they're live on your checkout now." });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Failed to save checkout questions." });
    } finally {
      setSaving(false);
    }
  }

  const unusedSuggestions = SUGGESTIONS.filter((s) => !fields.some((f) => f.label.trim().toLowerCase() === s.label.toLowerCase()));

  return (
    <div>
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "1.4rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#f0f2ff", margin: 0 }}>Checkout questions</h2>
        <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.45)", margin: "0.3rem 0 1.1rem", lineHeight: 1.5, maxWidth: 620 }}>
          Ask customers for anything else you need at checkout — name, email, phone and address are already collected.
          Answers show up on each order under <strong style={{ color: "rgba(240,242,255,0.7)" }}>Delivery info</strong>.
        </p>

        {fields.length === 0 && (
          <div style={{ padding: "1.5rem", textAlign: "center", borderRadius: 12, border: "1px dashed rgba(255,255,255,0.12)", color: "rgba(240,242,255,0.45)", fontSize: "0.83rem", marginBottom: "1rem" }}>
            No extra questions yet — checkout only asks for the basics.
          </div>
        )}

        <div style={{ display: "grid", gap: "0.75rem" }}>
          {fields.map((f, i) => (
            <div key={f.key} style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "0.9rem", background: "rgba(255,255,255,0.02)" }}>
              <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "flex-end" }}>
                <label style={{ flex: "2 1 220px" }}>
                  <span style={{ display: "block", fontSize: "0.74rem", fontWeight: 600, color: "#c5cbe8", marginBottom: "0.3rem" }}>Question</span>
                  <input type="text" value={f.label} maxLength={80} onChange={(e) => update(f.key, { label: e.target.value })} placeholder="e.g. Gift message" style={inputStyle} />
                </label>
                <label style={{ flex: "1 1 150px" }}>
                  <span style={{ display: "block", fontSize: "0.74rem", fontWeight: 600, color: "#c5cbe8", marginBottom: "0.3rem" }}>Answer type</span>
                  <select value={f.type} onChange={(e) => update(f.key, { type: e.target.value as CheckoutFieldType })} style={inputStyle}>
                    {(Object.keys(TYPE_LABELS) as CheckoutFieldType[]).map((t) => (
                      <option key={t} value={t} style={{ background: "#0d0f1a" }}>{TYPE_LABELS[t]}</option>
                    ))}
                  </select>
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", paddingBottom: "0.45rem" }}>
                  <Toggle checked={f.required} onChange={(v) => update(f.key, { required: v })} label="Required" />
                  <span style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.6)" }}>Required</span>
                </div>
                <div style={{ display: "flex", gap: "0.3rem", paddingBottom: "0.3rem", marginLeft: "auto" }}>
                  <IconButton label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</IconButton>
                  <IconButton label="Move down" disabled={i === fields.length - 1} onClick={() => move(i, 1)}>↓</IconButton>
                  <IconButton label="Remove question" danger onClick={() => setFields((prev) => prev.filter((x) => x.key !== f.key))}>✕</IconButton>
                </div>
              </div>
              {f.type === "select" ? (
                <label style={{ display: "block", marginTop: "0.6rem" }}>
                  <span style={{ display: "block", fontSize: "0.74rem", fontWeight: 600, color: "#c5cbe8", marginBottom: "0.3rem" }}>Choices (one per line)</span>
                  <textarea value={f.optionsText} rows={3} onChange={(e) => update(f.key, { optionsText: e.target.value })} placeholder={"Small\nMedium\nLarge"} style={{ ...inputStyle, resize: "vertical" }} />
                </label>
              ) : f.type !== "date" ? (
                <label style={{ display: "block", marginTop: "0.6rem" }}>
                  <span style={{ display: "block", fontSize: "0.74rem", fontWeight: 600, color: "#c5cbe8", marginBottom: "0.3rem" }}>Hint text (optional)</span>
                  <input type="text" value={f.placeholder ?? ""} maxLength={80} onChange={(e) => update(f.key, { placeholder: e.target.value })} placeholder="Shown inside the empty box" style={inputStyle} />
                </label>
              ) : null}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center", marginTop: "1rem" }}>
          <button
            type="button" disabled={fields.length >= MAX_FIELDS} onClick={() => setFields((prev) => [...prev, newDraft()])}
            style={{ padding: "0.55rem 1rem", borderRadius: 9, border: "none", background: "linear-gradient(135deg,var(--brand),var(--brand-deep))", color: "#fff", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit", opacity: fields.length >= MAX_FIELDS ? 0.5 : 1 }}
          >
            + Add question
          </button>
          {unusedSuggestions.length > 0 && fields.length < MAX_FIELDS && (
            <>
              <span style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.4)", marginLeft: "0.4rem" }}>Quick add:</span>
              {unusedSuggestions.map((sug) => (
                <button
                  key={sug.label} type="button" onClick={() => setFields((prev) => [...prev, newDraft(sug)])}
                  style={{ padding: "0.35rem 0.7rem", borderRadius: 999, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.03)", color: "rgba(240,242,255,0.75)", fontSize: "0.75rem", cursor: "pointer", fontFamily: "inherit" }}
                >
                  {sug.label}
                </button>
              ))}
            </>
          )}
        </div>
      </div>

      <SettingsActionBar saving={saving} message={message} onSave={() => void handleSave()} />
    </div>
  );
}

function IconButton({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}
      style={{
        width: 30, height: 30, borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)",
        color: danger ? "#f87171" : "rgba(240,242,255,0.7)", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.35 : 1, fontFamily: "inherit", fontSize: "0.8rem",
      }}
    >
      {children}
    </button>
  );
}
