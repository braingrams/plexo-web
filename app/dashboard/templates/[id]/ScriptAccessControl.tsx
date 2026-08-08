"use client";

import { useEffect, useRef, useState } from "react";

type Status = "NONE" | "PENDING" | "APPROVED_ACTIVE" | "APPROVED_EXPIRED" | "REJECTED";

type StatusResponse = {
  status: Status;
  requestId: string | null;
  remainingSeconds: number | null;
  rejectionReason: string | null;
  reason: string | null;
};

type Props = {
  templateId: string;
  /** Called only when the active/inactive boolean actually changes — see the isActive
   * effect below, keyed on the boolean itself rather than the raw status string, so a
   * same-status poll tick never re-fires this (the parent resets previewReady on each
   * call, which would otherwise spuriously re-trigger on every 5s poll). */
  onModeChange: (active: boolean) => void;
};

const POLL_MS = 5000;

function formatMMSS(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Requests / shows the state of staff-approved "full script preview" access for this
 * RAW_UPLOAD template's Text Content tab (normally sandboxed, no scripts — see
 * RawTextContentEditor.tsx). Polls the status endpoint while a request is pending or an
 * approval is active; the poll (not the local 1s countdown) is what actually ends the
 * privileged window in the parent, since a backgrounded tab's client clock can drift.
 */
export function ScriptAccessControl({ templateId, onModeChange }: Props) {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [localSeconds, setLocalSeconds] = useState<number | null>(null);
  const [reasonDraft, setReasonDraft] = useState("");
  const [showReasonInput, setShowReasonInput] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onModeChangeRef = useRef(onModeChange);
  onModeChangeRef.current = onModeChange;

  async function fetchStatus() {
    try {
      const res = await fetch(`/api/v1/templates/${templateId}/script-access`);
      if (!res.ok) return;
      const json: StatusResponse = await res.json();
      setData(json);
      if (json.status === "APPROVED_ACTIVE" && json.remainingSeconds !== null) {
        setLocalSeconds(json.remainingSeconds);
      }
    } catch {
      // Transient network hiccup — the next poll (or the initial fetch retry on remount)
      // will catch up; don't flip any state on a single miss.
    }
  }

  useEffect(() => {
    void fetchStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  useEffect(() => {
    if (!data) return;
    if (data.status !== "PENDING" && data.status !== "APPROVED_ACTIVE") return;
    const id = setInterval(() => void fetchStatus(), POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.status]);

  // Cosmetic only — ticks the displayed countdown between polls. Never itself flips
  // scriptsActive; only a poll observing something other than APPROVED_ACTIVE does that.
  useEffect(() => {
    if (data?.status !== "APPROVED_ACTIVE") return;
    const id = setInterval(() => {
      setLocalSeconds((s) => (s === null ? null : Math.max(0, s - 1)));
    }, 1000);
    return () => clearInterval(id);
  }, [data?.status]);

  const isActive = data?.status === "APPROVED_ACTIVE";
  useEffect(() => {
    onModeChangeRef.current(isActive);
  }, [isActive]);

  async function submitRequest() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/templates/${templateId}/script-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reasonDraft.trim() || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Failed to request script access.");
      setShowReasonInput(false);
      setReasonDraft("");
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to request script access.");
    } finally {
      setSubmitting(false);
    }
  }

  async function endEarly() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/templates/${templateId}/script-access`, { method: "PATCH" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Failed to end script access early.");
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to end script access early.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!data) return null;

  const rowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.75rem", flexWrap: "wrap" };
  const buttonStyle: React.CSSProperties = {
    padding: "0.3rem 0.7rem", borderRadius: 7, fontSize: "0.72rem", fontWeight: 600,
    background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.35)", color: "#c4b5fd",
    cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.6 : 1,
  };
  const inputStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6,
    color: "#f0f2ff", padding: "0.3rem 0.5rem", fontSize: "0.72rem", outline: "none", fontFamily: "inherit",
    minWidth: 200,
  };

  if (data.status === "APPROVED_ACTIVE") {
    return (
      <div style={rowStyle}>
        <span style={{ color: "#34d399", fontWeight: 700 }}>
          Full interactive preview active — {localSeconds !== null ? formatMMSS(localSeconds) : "…"} remaining
        </span>
        {error && <span style={{ color: "#f87171" }}>{error}</span>}
        <button
          type="button"
          onClick={() => void endEarly()}
          disabled={submitting}
          style={{ ...buttonStyle, background: "none", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(240,242,255,0.6)" }}
        >
          End early — back to editable preview
        </button>
      </div>
    );
  }

  if (data.status === "PENDING") {
    return (
      <div style={rowStyle}>
        <span style={{ color: "#f59e0b" }}>Full script preview requested — awaiting staff approval.</span>
      </div>
    );
  }

  // NONE, REJECTED, and APPROVED_EXPIRED all land here — a fresh request is allowed.
  return (
    <div style={rowStyle}>
      {data.status === "REJECTED" && data.rejectionReason && (
        <span style={{ color: "#f87171" }}>Request declined: {data.rejectionReason}</span>
      )}
      {data.status === "APPROVED_EXPIRED" && (
        <span style={{ color: "rgba(240,242,255,0.45)" }}>Your last grant expired.</span>
      )}
      {error && <span style={{ color: "#f87171" }}>{error}</span>}
      {showReasonInput ? (
        <>
          <input
            type="text"
            value={reasonDraft}
            onChange={(e) => setReasonDraft(e.target.value)}
            placeholder="Why do you need scripts enabled? (optional)"
            style={inputStyle}
          />
          <button type="button" onClick={() => void submitRequest()} disabled={submitting} style={buttonStyle}>
            {submitting ? "Sending…" : "Submit request"}
          </button>
          <button
            type="button"
            onClick={() => setShowReasonInput(false)}
            disabled={submitting}
            style={{ ...buttonStyle, background: "none", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(240,242,255,0.6)" }}
          >
            Cancel
          </button>
        </>
      ) : (
        <button type="button" onClick={() => setShowReasonInput(true)} style={buttonStyle}>
          Request full script preview
        </button>
      )}
    </div>
  );
}
