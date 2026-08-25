"use client";

import { useEffect, useState } from "react";

type Service = { id: string; name: string; durationMinutes: number | null };
type Rule = { id: string; dayOfWeek: number; startMinute: number; endMinute: number; timezone: string };
type Exception = { id: string; date: string; closed: boolean };

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function minutesToTimeInput(minutes: number): string {
  const h = Math.floor(minutes / 60).toString().padStart(2, "0");
  const m = (minutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

function timeInputToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

const inputStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 9, color: "#f0f2ff", padding: "0.5rem 0.7rem", fontSize: "0.82rem",
  outline: "none", fontFamily: "inherit",
};

export function AvailabilityClient({ templateId, services }: { templateId: string; services: Service[] }) {
  const [productId, setProductId] = useState(services[0]?.id ?? "");
  const [rules, setRules] = useState<Rule[]>([]);
  const [exceptions, setExceptions] = useState<Exception[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newDay, setNewDay] = useState(1);
  const [newStart, setNewStart] = useState("09:00");
  const [newEnd, setNewEnd] = useState("17:00");
  const [newTimezone, setNewTimezone] = useState("Africa/Lagos");
  const [newExceptionDate, setNewExceptionDate] = useState("");

  useEffect(() => {
    if (!productId) return;
    setLoading(true);
    fetch(`/api/v1/commerce/${templateId}/availability?productId=${productId}`)
      .then((res) => res.json())
      .then((data) => {
        setRules(data.rules ?? []);
        setExceptions(data.exceptions ?? []);
      })
      .finally(() => setLoading(false));
  }, [templateId, productId]);

  async function addRule() {
    setError(null);
    const startMinute = timeInputToMinutes(newStart);
    const endMinute = timeInputToMinutes(newEnd);
    if (startMinute >= endMinute) {
      setError("End time must be after start time.");
      return;
    }
    try {
      const res = await fetch(`/api/v1/commerce/${templateId}/availability`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "rule", productId, dayOfWeek: newDay, startMinute, endMinute, timezone: newTimezone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add rule.");
      setRules((prev) => [...prev, data.rule].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startMinute - b.startMinute));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add rule.");
    }
  }

  async function deleteRule(id: string) {
    await fetch(`/api/v1/commerce/${templateId}/availability/${id}?type=rule`, { method: "DELETE" });
    setRules((prev) => prev.filter((r) => r.id !== id));
  }

  async function addException() {
    setError(null);
    if (!newExceptionDate) {
      setError("Pick a date to close.");
      return;
    }
    try {
      const res = await fetch(`/api/v1/commerce/${templateId}/availability`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "exception", productId, date: newExceptionDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to close that date.");
      setExceptions((prev) => [...prev, data.exception].sort((a, b) => a.date.localeCompare(b.date)));
      setNewExceptionDate("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to close that date.");
    }
  }

  async function deleteException(id: string) {
    await fetch(`/api/v1/commerce/${templateId}/availability/${id}?type=exception`, { method: "DELETE" });
    setExceptions((prev) => prev.filter((e) => e.id !== id));
  }

  if (services.length === 0) {
    return (
      <div>
        <div style={{ marginBottom: "1.5rem" }}>
          <h1 style={{ fontSize: "1.35rem", fontWeight: 600, color: "#f0f2ff", margin: 0 }}>Availability</h1>
        </div>
        <div style={{ padding: "3rem 2rem", textAlign: "center", borderRadius: 14, border: "1px dashed rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.02)", color: "rgba(240,242,255,0.45)", fontSize: "0.85rem" }}>
          No bookable services yet — add one under Products first (choose "Service / Booking").
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 600, color: "#f0f2ff", margin: 0 }}>Availability</h1>
        <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.5)", marginTop: 4 }}>Weekly hours and one-off closures per service.</p>
      </div>

      <select value={productId} onChange={(e) => setProductId(e.target.value)} style={{ ...inputStyle, marginBottom: "1.5rem", width: "100%", maxWidth: 320 }}>
        {services.map((s) => (
          <option key={s.id} value={s.id} style={{ background: "#0d0f1a" }}>{s.name}</option>
        ))}
      </select>

      {loading ? (
        <p style={{ color: "rgba(240,242,255,0.4)", fontSize: "0.85rem" }}>Loading…</p>
      ) : (
        <>
          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "1.4rem", marginBottom: "1.25rem" }}>
            <h2 style={{ fontSize: "0.95rem", fontWeight: 700, color: "#f0f2ff", marginBottom: "1rem" }}>Weekly hours</h2>

            {rules.length === 0 ? (
              <p style={{ fontSize: "0.82rem", color: "rgba(240,242,255,0.4)", marginBottom: "1rem" }}>No open hours set yet — nothing is bookable until you add some below.</p>
            ) : (
              <div style={{ marginBottom: "1rem" }}>
                {rules.map((rule) => (
                  <div key={rule.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.5rem 0", borderTop: "1px solid rgba(255,255,255,0.06)", fontSize: "0.85rem", color: "#e2e4f5" }}>
                    <span>
                      {DAY_NAMES[rule.dayOfWeek]} · {minutesToTimeInput(rule.startMinute)}–{minutesToTimeInput(rule.endMinute)} ({rule.timezone})
                    </span>
                    <button type="button" onClick={() => void deleteRule(rule.id)} style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: "0.8rem", fontFamily: "inherit" }}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-end" }}>
              <select value={newDay} onChange={(e) => setNewDay(Number(e.target.value))} style={inputStyle}>
                {DAY_NAMES.map((name, i) => (
                  <option key={i} value={i} style={{ background: "#0d0f1a" }}>{name}</option>
                ))}
              </select>
              <input type="time" value={newStart} onChange={(e) => setNewStart(e.target.value)} style={inputStyle} />
              <input type="time" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} style={inputStyle} />
              <input type="text" value={newTimezone} onChange={(e) => setNewTimezone(e.target.value)} placeholder="Africa/Lagos" style={{ ...inputStyle, width: 140 }} />
              <button
                type="button" onClick={() => void addRule()}
                style={{ padding: "0.55rem 1rem", borderRadius: 9, border: "none", background: "linear-gradient(135deg,var(--brand),var(--brand-deep))", color: "#fff", cursor: "pointer", fontFamily: "inherit", fontSize: "0.82rem", fontWeight: 700 }}
              >
                + Add
              </button>
            </div>
          </div>

          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "1.4rem" }}>
            <h2 style={{ fontSize: "0.95rem", fontWeight: 700, color: "#f0f2ff", marginBottom: "1rem" }}>Closed dates</h2>

            {exceptions.length === 0 ? (
              <p style={{ fontSize: "0.82rem", color: "rgba(240,242,255,0.4)", marginBottom: "1rem" }}>No closures set.</p>
            ) : (
              <div style={{ marginBottom: "1rem" }}>
                {exceptions.map((exception) => (
                  <div key={exception.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.5rem 0", borderTop: "1px solid rgba(255,255,255,0.06)", fontSize: "0.85rem", color: "#e2e4f5" }}>
                    <span>{new Date(exception.date).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })}</span>
                    <button type="button" onClick={() => void deleteException(exception.id)} style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: "0.8rem", fontFamily: "inherit" }}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input type="date" value={newExceptionDate} onChange={(e) => setNewExceptionDate(e.target.value)} style={inputStyle} />
              <button
                type="button" onClick={() => void addException()}
                style={{ padding: "0.55rem 1rem", borderRadius: 9, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "#f0f2ff", cursor: "pointer", fontFamily: "inherit", fontSize: "0.82rem" }}
              >
                Close this date
              </button>
            </div>
          </div>
        </>
      )}

      {error && <p style={{ fontSize: "0.82rem", color: "#f87171", marginTop: "1rem" }}>{error}</p>}
    </div>
  );
}
