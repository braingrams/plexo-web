"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/commerce/formatMoney";
import { Toggle } from "@/app/dashboard/_components/Toggle";

export type DeliveryMethodSummary = {
  id: string;
  name: string;
  type: "PICKUP" | "COURIER";
  feeMinor: number;
  description: string | null;
  countries: string[];
  states: string[];
  estimatedTimeLabel: string | null;
  status: "ACTIVE" | "INACTIVE";
};

const inputStyle: React.CSSProperties = {
  width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 9, color: "#f0f2ff", padding: "0.55rem 0.75rem", fontSize: "0.85rem",
  outline: "none", fontFamily: "inherit",
};

function FieldLabel({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#c5cbe8", marginBottom: "0.35rem" }}>{label}</span>
      {children}
      {hint && <span style={{ display: "block", fontSize: "0.72rem", color: "rgba(240,242,255,0.35)", marginTop: "0.3rem" }}>{hint}</span>}
    </label>
  );
}

function scopeLabel(m: Pick<DeliveryMethodSummary, "countries" | "states">): string {
  if (!m.countries.length) return "Worldwide";
  const countries = m.countries.join(", ");
  return m.states.length ? `${countries} — ${m.states.join(", ")}` : countries;
}

function IconPickup() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--brand-light)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}
function IconCourier() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="7" width="13" height="9" rx="1" /><path d="M14 10h4l4 3.5V16h-8z" /><circle cx="6" cy="18.5" r="1.7" /><circle cx="17.5" cy="18.5" r="1.7" />
    </svg>
  );
}

type FormState = {
  id: string | null;
  name: string;
  type: "PICKUP" | "COURIER";
  feeMajor: string;
  free: boolean;
  countries: string;
  states: string;
  estimatedTimeLabel: string;
  description: string;
  status: "ACTIVE" | "INACTIVE";
};

export type FulfillmentSettings = {
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  pickupLocation: string | null;
  pickupInstructions: string | null;
};

/**
 * The two store-wide switches above the method list: whether shipping is offered at all,
 * and the built-in "Store pickup" option (on by default for every store, so physical
 * products can sell before any delivery method exists). Saved on its own — it's a
 * CommerceSettings change, not a delivery-method row.
 */
function FulfillmentCard({ templateId, initial, hasCourierMethods }: { templateId: string; initial: FulfillmentSettings; hasCourierMethods: boolean }) {
  const [deliveryEnabled, setDeliveryEnabled] = useState(initial.deliveryEnabled);
  const [pickupEnabled, setPickupEnabled] = useState(initial.pickupEnabled);
  const [pickupLocation, setPickupLocation] = useState(initial.pickupLocation ?? "");
  const [pickupInstructions, setPickupInstructions] = useState(initial.pickupInstructions ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/commerce/${templateId}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deliveryEnabled, pickupEnabled, pickupLocation, pickupInstructions }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save.");
      setMessage({ kind: "success", text: "Saved." });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Failed to save." });
    } finally {
      setSaving(false);
    }
  }

  const rowStyle: React.CSSProperties = { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem" };
  return (
    <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "1.2rem 1.3rem", marginBottom: "1.25rem", display: "grid", gap: "1.1rem" }}>
      <div style={rowStyle}>
        <div style={{ display: "flex", gap: "0.8rem" }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, background: "rgba(96,165,250,0.14)", display: "grid", placeItems: "center" }}><IconCourier /></div>
          <div>
            <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "#f0f2ff" }}>Delivery</div>
            <div style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.45)", marginTop: 2, lineHeight: 1.45 }}>
              {deliveryEnabled
                ? hasCourierMethods
                  ? "Customers can have orders shipped using your shipping methods below."
                  : "On, but you haven't added a shipping method yet — add one below, or turn delivery off and offer pickup only."
                : "Off — customers won't see any shipping options at checkout."}
            </div>
          </div>
        </div>
        <Toggle checked={deliveryEnabled} disabled={deliveryEnabled && !pickupEnabled} onChange={setDeliveryEnabled} label="Offer delivery" />
      </div>

      <div style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />

      <div style={rowStyle}>
        <div style={{ display: "flex", gap: "0.8rem" }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, background: "rgba(var(--brand-rgb),0.14)", display: "grid", placeItems: "center" }}><IconPickup /></div>
          <div>
            <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "#f0f2ff" }}>Store pickup <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "#34d399", marginLeft: 6 }}>FREE</span></div>
            <div style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.45)", marginTop: 2, lineHeight: 1.45 }}>
              Customers can choose to collect their order from you. You&apos;ll let them know when it&apos;s ready.
            </div>
          </div>
        </div>
        <Toggle checked={pickupEnabled} disabled={pickupEnabled && !deliveryEnabled} onChange={setPickupEnabled} label="Offer store pickup" />
      </div>

      {pickupEnabled && (
        <div style={{ display: "grid", gap: "0.8rem", paddingLeft: "calc(36px + 0.8rem)" }}>
          {!pickupLocation.trim() && (
            <div style={{ fontSize: "0.78rem", color: "#fbbf24", background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: 9, padding: "0.55rem 0.75rem" }}>
              Add your store&apos;s address so customers can see where to pick up before they order.
            </div>
          )}
          <FieldLabel label="Pickup address" hint="Shown at checkout and on the customer's order confirmation.">
            <textarea value={pickupLocation} onChange={(e) => setPickupLocation(e.target.value)} rows={2} maxLength={300} placeholder="e.g. 12 Admiralty Way, Lekki Phase 1, Lagos" style={{ ...inputStyle, resize: "vertical" }} />
          </FieldLabel>
          <FieldLabel label="Pickup hours / notes (optional)">
            <input type="text" value={pickupInstructions} onChange={(e) => setPickupInstructions(e.target.value)} maxLength={500} placeholder="e.g. Mon–Sat, 9am–6pm. Call 0803… on arrival." style={inputStyle} />
          </FieldLabel>
        </div>
      )}

      {!deliveryEnabled || !pickupEnabled ? (
        <p style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.35)", margin: 0 }}>At least one of delivery or pickup must stay on so customers can receive physical products.</p>
      ) : null}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "0.8rem" }}>
        {message && <span style={{ fontSize: "0.8rem", color: message.kind === "success" ? "#34d399" : "#f87171", marginRight: "auto" }}>{message.text}</span>}
        <button
          type="button" onClick={() => void save()} disabled={saving}
          style={{ padding: "0.55rem 1.1rem", borderRadius: 9, border: "none", background: "linear-gradient(135deg,var(--brand),var(--brand-deep))", color: "#fff", cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1, fontFamily: "inherit", fontSize: "0.82rem", fontWeight: 700 }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

const EMPTY_FORM: FormState = {
  id: null, name: "", type: "PICKUP", feeMajor: "", free: true, countries: "", states: "", estimatedTimeLabel: "", description: "", status: "ACTIVE",
};

export function DeliveryClient({
  templateId, initialMethods, currency, initialFulfillment,
}: {
  templateId: string;
  initialMethods: DeliveryMethodSummary[];
  currency: string;
  initialFulfillment: FulfillmentSettings;
}) {
  const [methods, setMethods] = useState(initialMethods);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiBase = `/api/v1/commerce/${templateId}/delivery-methods`;

  function openCreate() {
    setForm(EMPTY_FORM);
    setError(null);
    setModalOpen(true);
  }

  function openEdit(method: DeliveryMethodSummary) {
    setForm({
      id: method.id,
      name: method.name,
      type: method.type,
      feeMajor: method.feeMinor ? String(method.feeMinor / 100) : "",
      free: method.feeMinor === 0,
      countries: method.countries.join(", "),
      states: method.states.join(", "),
      estimatedTimeLabel: method.estimatedTimeLabel ?? "",
      description: method.description ?? "",
      status: method.status,
    });
    setError(null);
    setModalOpen(true);
  }

  async function handleSave() {
    setError(null);
    const trimmedName = form.name.trim();
    if (!trimmedName) {
      setError("A name is required.");
      return;
    }
    const feeMinor = form.free ? 0 : Math.round(Number(form.feeMajor) * 100);
    if (!form.free && (!Number.isFinite(feeMinor) || feeMinor < 0)) {
      setError("Enter a valid cost.");
      return;
    }
    const payload = {
      name: trimmedName,
      type: form.type,
      feeMinor,
      countries: form.countries.split(",").map((s) => s.trim()).filter(Boolean),
      states: form.states.split(",").map((s) => s.trim()).filter(Boolean),
      estimatedTimeLabel: form.estimatedTimeLabel.trim() || undefined,
      // For a pickup method this IS its pickup address (shown to customers at checkout and
      // snapshotted onto the order — see pickupLocationFor). "" clears it on edit.
      description: form.description.trim(),
      status: form.status,
    };

    setSaving(true);
    try {
      const res = await fetch(form.id ? `${apiBase}/${form.id}` : apiBase, {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save delivery method.");

      const saved = data.method;
      const summary: DeliveryMethodSummary = {
        id: saved.id,
        name: saved.name,
        type: saved.type,
        feeMinor: saved.feeMinor ?? 0,
        description: saved.description ?? null,
        countries: saved.countries ?? [],
        states: saved.states ?? [],
        estimatedTimeLabel: saved.estimatedTimeLabel ?? null,
        status: saved.status ?? "ACTIVE",
      };
      setMethods((prev) => (form.id ? prev.map((m) => (m.id === summary.id ? summary : m)) : [...prev, summary]));
      setModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save delivery method.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(method: DeliveryMethodSummary) {
    const nextStatus = method.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    const res = await fetch(`${apiBase}/${method.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    if (res.ok) {
      setMethods((prev) => prev.map((m) => (m.id === method.id ? { ...m, status: nextStatus } : m)));
    }
  }

  async function handleDelete(method: DeliveryMethodSummary) {
    if (!confirm(`Delete "${method.name}"? This can't be undone.`)) return;
    const res = await fetch(`${apiBase}/${method.id}`, { method: "DELETE" });
    if (res.ok) {
      setMethods((prev) => prev.filter((m) => m.id !== method.id));
    }
  }

  return (
    <div>
      <FulfillmentCard templateId={templateId} initial={initialFulfillment} hasCourierMethods={methods.some((m) => m.type === "COURIER" && m.status === "ACTIVE")} />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", marginBottom: "1.25rem" }}>
        <span style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.5)" }}>{methods.length} delivery method{methods.length === 1 ? "" : "s"}</span>
        <button
          type="button" onClick={openCreate}
          style={{ padding: "0.6rem 1.1rem", borderRadius: 10, border: "none", cursor: "pointer", fontSize: "0.85rem", fontWeight: 700, fontFamily: "inherit", background: "linear-gradient(135deg,var(--brand),var(--brand-deep))", color: "#fff" }}
        >
          + Add method
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", background: "rgba(var(--brand-rgb),0.08)", border: "1px solid rgba(var(--brand-rgb),0.2)", borderRadius: 12, padding: "0.7rem 1rem", marginBottom: "1.25rem", fontSize: "0.82rem", color: "#c4b5fd" }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
        A customer only sees the shipping methods that match their delivery address — set each one&apos;s country and state coverage below. Pickup options are shown to everyone.
      </div>

      {methods.length === 0 ? (
        <div style={{ padding: "3rem 2rem", textAlign: "center", borderRadius: 14, border: "1px dashed rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.02)", color: "rgba(240,242,255,0.45)", fontSize: "0.85rem" }}>
          {initialFulfillment.pickupEnabled
            ? "No extra delivery methods yet — customers can still choose Store pickup. Add a shipping method to deliver to their address."
            : "No delivery methods yet — add one so checkout has something to offer customers."}
        </div>
      ) : (
        methods.map((m) => (
          <div key={m.id} style={{ display: "flex", alignItems: "center", gap: "0.9rem", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "1rem 1.2rem", marginBottom: "0.7rem" }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0, background: m.type === "PICKUP" ? "rgba(var(--brand-rgb),0.14)" : "rgba(96,165,250,0.14)", display: "grid", placeItems: "center" }}>
              {m.type === "PICKUP" ? <IconPickup /> : <IconCourier />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "#f0f2ff" }}>{m.name}</div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginTop: 3, flexWrap: "wrap" }}>
                <span style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.5)", background: "rgba(255,255,255,0.05)", borderRadius: 999, padding: "0.15rem 0.55rem" }}>{m.type === "PICKUP" ? m.description || "No pickup address yet — edit to add one" : scopeLabel(m)}</span>
                {m.estimatedTimeLabel && <span style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.45)" }}>{m.estimatedTimeLabel}</span>}
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: "0.92rem", fontWeight: 700, color: "#f0f2ff", fontFamily: "ui-monospace, monospace" }}>
                {m.feeMinor === 0 ? "Free" : formatMoney(m.feeMinor, currency)}
              </div>
              <button
                type="button" onClick={() => void toggleStatus(m)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.66rem", fontWeight: 700, letterSpacing: "0.03em", textTransform: "uppercase", color: m.status === "ACTIVE" ? "#34d399" : "rgba(240,242,255,0.4)", fontFamily: "inherit", padding: 0 }}
              >
                {m.status === "ACTIVE" ? "Active" : "Draft"}
              </button>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
              <button type="button" onClick={() => openEdit(m)} style={{ padding: "0.5rem 0.85rem", borderRadius: 9, fontSize: "0.8rem", fontWeight: 600, color: "rgba(240,242,255,0.7)", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", cursor: "pointer", fontFamily: "inherit" }}>
                Edit
              </button>
              <button type="button" onClick={() => void handleDelete(m)} style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: "0.8rem", fontFamily: "inherit" }}>
                Delete
              </button>
            </div>
          </div>
        ))
      )}

      {modalOpen && (
        <div
          role="dialog" aria-modal="true"
          style={{ position: "fixed", inset: 0, zIndex: 60, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.7)", padding: "1rem" }}
          onClick={(e) => { if (e.target === e.currentTarget) setModalOpen(false); }}
        >
          <div style={{ width: "min(100%,460px)", maxHeight: "88vh", overflowY: "auto", background: "#0d0f1a", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 20, padding: "1.75rem" }}>
            <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1.15rem", fontWeight: 800, color: "#f0f2ff", marginBottom: "1.25rem" }}>
              {form.id ? "Edit delivery method" : "New delivery method"}
            </h2>

            <div style={{ display: "grid", gap: "1rem" }}>
              <FieldLabel label="Name">
                <input type="text" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="Lagos showroom pickup" style={inputStyle} />
              </FieldLabel>

              <div style={{ display: "flex", gap: "0.5rem" }}>
                {(["PICKUP", "COURIER"] as const).map((t) => (
                  <button
                    key={t} type="button" onClick={() => setForm((p) => ({ ...p, type: t }))}
                    style={{
                      flex: 1, padding: "0.55rem", borderRadius: 9, cursor: "pointer", fontFamily: "inherit",
                      border: form.type === t ? "1.5px solid var(--brand)" : "1px solid rgba(255,255,255,0.1)",
                      background: form.type === t ? "var(--brand-subtle)" : "rgba(255,255,255,0.03)",
                      color: form.type === t ? "var(--brand)" : "rgba(240,242,255,0.6)", fontWeight: 600, fontSize: "0.82rem",
                    }}
                  >
                    {t === "PICKUP" ? "Pickup" : "Shipping"}
                  </button>
                ))}
              </div>

              <div>
                <label style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: form.free ? 0 : "0.6rem", cursor: "pointer" }}>
                  <input type="checkbox" checked={form.free} onChange={(e) => setForm((p) => ({ ...p, free: e.target.checked }))} style={{ width: 16, height: 16 }} />
                  <span style={{ fontSize: "0.82rem", color: "#f0f2ff" }}>Free</span>
                </label>
                {!form.free && (
                  <FieldLabel label={`Cost`}>
                    <input type="number" value={form.feeMajor} onChange={(e) => setForm((p) => ({ ...p, feeMajor: e.target.value }))} placeholder="1500" style={inputStyle} />
                  </FieldLabel>
                )}
              </div>

              {form.type === "PICKUP" && (
                <FieldLabel label="Pickup address" hint="Where customers collect from — shown at checkout and on their order.">
                  <textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} rows={2} placeholder="e.g. 12 Admiralty Way, Lekki Phase 1, Lagos" style={{ ...inputStyle, resize: "vertical" }} />
                </FieldLabel>
              )}

              {form.type === "COURIER" && (<>
              <FieldLabel label="Country coverage" hint="Comma-separated ISO country codes (e.g. NG). Leave blank for worldwide.">
                <input type="text" value={form.countries} onChange={(e) => setForm((p) => ({ ...p, countries: e.target.value }))} placeholder="NG" style={inputStyle} />
              </FieldLabel>

              <FieldLabel label="State coverage (optional)" hint="Comma-separated. Leave blank for every state in the countries above.">
                <input type="text" value={form.states} onChange={(e) => setForm((p) => ({ ...p, states: e.target.value }))} placeholder="Lagos, Abuja" style={inputStyle} />
              </FieldLabel>
              </>)}

              <FieldLabel label="Estimated delivery time (optional)">
                <input type="text" value={form.estimatedTimeLabel} onChange={(e) => setForm((p) => ({ ...p, estimatedTimeLabel: e.target.value }))} placeholder="1-2 business days" style={inputStyle} />
              </FieldLabel>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "0.82rem", color: "#f0f2ff" }}>Active</span>
                <Toggle checked={form.status === "ACTIVE"} onChange={(v) => setForm((p) => ({ ...p, status: v ? "ACTIVE" : "INACTIVE" }))} />
              </div>

              {error && <p style={{ fontSize: "0.82rem", color: "#f87171" }}>{error}</p>}

              <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
                <button type="button" onClick={() => setModalOpen(false)} style={{ padding: "0.6rem 1.1rem", borderRadius: 9, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "rgba(240,242,255,0.65)", cursor: "pointer", fontFamily: "inherit", fontSize: "0.85rem", fontWeight: 600 }}>
                  Cancel
                </button>
                <button
                  type="button" onClick={() => void handleSave()} disabled={saving}
                  style={{ padding: "0.6rem 1.4rem", borderRadius: 9, border: "none", background: "linear-gradient(135deg,var(--brand),var(--brand-deep))", color: "#fff", cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1, fontFamily: "inherit", fontSize: "0.85rem", fontWeight: 700 }}
                >
                  {saving ? "Saving…" : form.id ? "Save changes" : "Add method"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
