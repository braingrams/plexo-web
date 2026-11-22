"use client";

import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import { useState } from "react";
import { DAY_NAMES, minutesToTimeInput, timeInputToMinutes } from "@/lib/commerce/bookingTimes";
import { useAvailability } from "./useAvailability";

type Service = { id: string; name: string; durationMinutes: number | null };


const inputStyle: React.CSSProperties = {
  background: "color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 4%, transparent)", border: "1px solid color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 10%, transparent)",
  borderRadius: 9, color: "var(--cmx-text, #f0f2ff)", padding: "0.5rem 0.7rem", fontSize: "0.82rem",
  outline: "none", fontFamily: "inherit",
};

export function AvailabilityClient({ templateId, services }: { templateId: string; services: Service[] }) {
  const [productId, setProductId] = useState(services[0]?.id ?? "");
  const av = useAvailability(templateId, productId);
  const { rules, exceptions, loading, error, deleteRule, deleteException } = av;
  const [newDay, setNewDay] = useState(1);
  const [newStart, setNewStart] = useState("09:00");
  const [newEnd, setNewEnd] = useState("17:00");
  const [newTimezone, setNewTimezone] = useState("Africa/Lagos");
  const [newExceptionDate, setNewExceptionDate] = useState("");

  async function addRule() {
    if (timeInputToMinutes(newStart) >= timeInputToMinutes(newEnd)) return av.setError("End time must be after start time.");
    await av.addRule({ dayOfWeek: newDay, start: newStart, end: newEnd, timezone: newTimezone });
  }
  async function addException() {
    if (await av.addException(newExceptionDate)) setNewExceptionDate("");
  }

  if (services.length === 0) {
    return (
      <div style={{ padding: "3rem 2rem", textAlign: "center", borderRadius: 14, border: "1px dashed color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 12%, transparent)", background: "color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 2%, transparent)", color: "var(--cmx-muted, rgba(240,242,255,0.45))", fontSize: "0.85rem" }}>
        No bookable services yet — add one under Products first (choose "Service / Booking").
      </div>
    );
  }

  return (
    <div>
      <p style={{ fontSize: "0.85rem", color: "var(--cmx-muted, rgba(240,242,255,0.5))", marginBottom: "1.25rem" }}>Weekly hours and one-off closures per service.</p>

      <select value={productId} onChange={(e) => setProductId(e.target.value)} style={{ ...inputStyle, marginBottom: "1.5rem", width: "100%", maxWidth: 320 }}>
        {services.map((s) => (
          <option key={s.id} value={s.id} style={{ background: "var(--cmx-surface, #0d0f1a)" }}>{s.name}</option>
        ))}
      </select>

      {loading ? (
        <p style={{ color: "var(--cmx-muted, rgba(240,242,255,0.4))", fontSize: "0.85rem" }}>Loading…</p>
      ) : (
        <>
          <div style={{ background: "color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 2%, transparent)", border: "1px solid color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 8%, transparent)", borderRadius: 14, padding: "1.4rem", marginBottom: "1.25rem" }}>
            <h2 style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--cmx-text, #f0f2ff)", marginBottom: "1rem" }}>Weekly hours</h2>

            {rules.length === 0 ? (
              <p style={{ fontSize: "0.82rem", color: "var(--cmx-muted, rgba(240,242,255,0.4))", marginBottom: "1rem" }}>No open hours set yet — nothing is bookable until you add some below.</p>
            ) : (
              <div style={{ marginBottom: "1rem" }}>
                {rules.map((rule) => (
                  <div key={rule.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.5rem 0", borderTop: "1px solid color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 6%, transparent)", fontSize: "0.85rem", color: "var(--cmx-text, #e2e4f5)" }}>
                    <span>
                      {DAY_NAMES[rule.dayOfWeek]} · {minutesToTimeInput(rule.startMinute)}–{minutesToTimeInput(rule.endMinute)} ({rule.timezone})
                    </span>
                    <button type="button" onClick={() => void deleteRule(rule.id)} style={{ background: "none", border: "none", color: "var(--cmx-danger, #f87171)", cursor: "pointer", fontSize: "0.8rem", fontFamily: "inherit" }}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-end" }}>
              <select value={newDay} onChange={(e) => setNewDay(Number(e.target.value))} style={inputStyle}>
                {DAY_NAMES.map((name, i) => (
                  <option key={i} value={i} style={{ background: "var(--cmx-surface, #0d0f1a)" }}>{name}</option>
                ))}
              </select>
              <input type="time" value={newStart} onChange={(e) => setNewStart(e.target.value)} style={inputStyle} />
              <input type="time" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} style={inputStyle} />
              <input type="text" value={newTimezone} onChange={(e) => setNewTimezone(e.target.value)} placeholder="Africa/Lagos" style={{ ...inputStyle, width: 140 }} />
              <button
                type="button" onClick={() => void addRule()}
                style={{ padding: "0.55rem 1rem", borderRadius: 9, border: "none", background: "linear-gradient(135deg,var(--brand),var(--cmx-brand-deep, var(--brand-deep)))", color: "var(--cmx-on-brand, #fff)", cursor: "pointer", fontFamily: "inherit", fontSize: "0.82rem", fontWeight: 700 }}
              >
                + Add
              </button>
            </div>
          </div>

          <div style={{ background: "color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 2%, transparent)", border: "1px solid color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 8%, transparent)", borderRadius: 14, padding: "1.4rem" }}>
            <h2 style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--cmx-text, #f0f2ff)", marginBottom: "1rem" }}>Closed dates</h2>

            {exceptions.length === 0 ? (
              <p style={{ fontSize: "0.82rem", color: "var(--cmx-muted, rgba(240,242,255,0.4))", marginBottom: "1rem" }}>No closures set.</p>
            ) : (
              <div style={{ marginBottom: "1rem" }}>
                {exceptions.map((exception) => (
                  <div key={exception.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.5rem 0", borderTop: "1px solid color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 6%, transparent)", fontSize: "0.85rem", color: "var(--cmx-text, #e2e4f5)" }}>
                    <span>{new Date(exception.date).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })}</span>
                    <button type="button" onClick={() => void deleteException(exception.id)} style={{ background: "none", border: "none", color: "var(--cmx-danger, #f87171)", cursor: "pointer", fontSize: "0.8rem", fontFamily: "inherit" }}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <input type="date" value={newExceptionDate} onChange={(e) => setNewExceptionDate(e.target.value)} style={inputStyle} />
              <button
                type="button" onClick={() => void addException()}
                style={{ padding: "0.55rem 1rem", borderRadius: 9, border: "1px solid color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 10%, transparent)", background: "color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 5%, transparent)", color: "var(--cmx-text, #f0f2ff)", cursor: "pointer", fontFamily: "inherit", fontSize: "0.82rem" }}
              >
                Close this date
              </button>
            </div>
          </div>
        </>
      )}

      {error && <GateOrError error={error}><p style={{ fontSize: "0.82rem", color: "var(--cmx-danger, #f87171)", marginTop: "1rem" }}>{error}</p></GateOrError>}
    </div>
  );
}
