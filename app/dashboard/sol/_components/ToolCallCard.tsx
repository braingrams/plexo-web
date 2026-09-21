"use client";

import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, CircleAlert, CircleX, Loader2, ShieldAlert, Wrench } from "lucide-react";
import { StepCard, type StepStatus } from "./StepCard";
import type { ToolUseBlock } from "./types";

function toStepStatus(status: ToolUseBlock["status"]): StepStatus {
  if (status === "success") return "success";
  if (status === "error") return "error";
  if (status === "cancelled") return "cancelled";
  if (status === "running" || status === "awaiting_confirmation") return "running";
  return "pending";
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// Common leading verbs in Plexo's MCP tool names, mapped to a natural past-tense phrasing
// so a call reads as a finished sentence fragment ("Checked user profile") instead of a
// mechanically title-cased tool name ("Get User Profile") — and, critically, computed
// fresh from `block.name` every time rather than trusting `block.label` (see this
// component's own comment on why that field can't be relied on for history).
const VERB_PAST_TENSE: Record<string, string> = {
  get: "Checked",
  list: "Looked up",
  find: "Looked up",
  search: "Searched",
  create: "Created",
  add: "Added",
  delete: "Deleted",
  remove: "Removed",
  update: "Updated",
  edit: "Updated",
  set: "Set",
  publish: "Published",
  unpublish: "Unpublished",
  archive: "Archived",
  restore: "Restored",
  duplicate: "Duplicated",
  clone: "Duplicated",
  rename: "Renamed",
  move: "Moved",
  enable: "Enabled",
  disable: "Disabled",
  connect: "Connected",
  disconnect: "Disconnected",
  refund: "Refunded",
  cancel: "Cancelled",
  send: "Sent",
  generate: "Generated",
  upload: "Uploaded",
  import: "Imported",
  export: "Exported",
};

function humanizeToolLabel(name: string): string {
  const parts = name.split("_").filter(Boolean);
  if (parts.length === 0) return name;
  const [verb, ...rest] = parts;
  const pastTense = VERB_PAST_TENSE[verb.toLowerCase()];
  if (pastTense) {
    const restLabel = rest.join(" ");
    return restLabel ? `${pastTense} ${restLabel}` : pastTense;
  }
  // Unrecognized verb — same Title Case fallback the old server-side humanizer always
  // used, still readable even without a natural-sentence phrasing available for it.
  return parts.map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
}

const COMPACT_ICON_COLOR: Record<StepStatus, string> = {
  pending: "rgba(240,242,255,0.35)",
  running: "#c4b5fd",
  success: "#34d399",
  error: "#f87171",
  cancelled: "rgba(240,242,255,0.35)",
};

function CompactStatusIcon({ status }: { status: StepStatus }) {
  const color = COMPACT_ICON_COLOR[status];
  if (status === "running") return <Loader2 size={12} color={color} style={{ animation: "sol-spin 0.9s linear infinite" }} />;
  if (status === "success") return <CheckCircle2 size={12} color={color} />;
  if (status === "error") return <CircleX size={12} color={color} />;
  if (status === "cancelled") return <CircleAlert size={12} color={color} />;
  return <CircleAlert size={12} color={color} />;
}

/** Renders one tool_use/tool_result pair. An ordinary (auto-executed, non-destructive)
 * call is just a single compact line — an icon and its label, no card, no expandable
 * input/output — since it already happened without needing the user's attention at all;
 * a whole bordered card with a "Show details" toggle for something like "checked your
 * profile" was more visual weight than the action itself warrants. A destructive call SOL
 * paused on for confirmation keeps the full card treatment (inline Confirm/Cancel, plus
 * the expandable input so the user can actually see what they're about to authorize). */
export function ToolCallCard({
  block,
  onConfirm,
  confirmBusy,
  resolvingConfirmation,
}: {
  block: ToolUseBlock;
  onConfirm?: (decision: "confirmed" | "declined") => void;
  confirmBusy?: boolean;
  resolvingConfirmation?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isAwaitingConfirmation = block.status === "awaiting_confirmation";
  // Always derived fresh from `block.name` — `block.label` is only ever populated by the
  // LIVE stream's tool_call_start frame (see useSolStream.ts); a message loaded from
  // history never had that field persisted (SolMessage.content is the raw model content
  // block, with no room for a client-only rendering label), so relying on `block.label`
  // meant a reloaded conversation fell back to showing the bare snake_case tool name.
  const label = humanizeToolLabel(block.name);

  if (!isAwaitingConfirmation) {
    return (
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, maxWidth: "100%" }}>
        <style>{`@keyframes sol-spin { to { transform: rotate(360deg); } }`}</style>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.45rem",
            width: "100%",
            padding: "0.15rem 0",
            background: "none",
            border: "none",
            cursor: "pointer",
            fontFamily: "inherit",
            textAlign: "left",
          }}
        >
          <CompactStatusIcon status={toStepStatus(block.status)} />
          <span style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.55)", flex: 1 }}>{label}</span>
          {expanded ? (
            <ChevronUp size={12} color="rgba(240,242,255,0.35)" />
          ) : (
            <ChevronDown size={12} color="rgba(240,242,255,0.35)" />
          )}
        </button>
        {expanded && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", padding: "0.3rem 0 0.2rem 1.65rem", minWidth: 0, maxWidth: "100%", boxSizing: "border-box" }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: "0.64rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "rgba(240,242,255,0.35)", marginBottom: "0.2rem" }}>
                Input
              </p>
              <pre style={{ margin: 0, maxWidth: "100%", boxSizing: "border-box", fontSize: "0.7rem", color: "rgba(240,242,255,0.7)", background: "rgba(0,0,0,0.25)", borderRadius: 8, padding: "0.45rem 0.55rem", overflowX: "auto", fontFamily: "var(--font-mono, monospace)" }}>
                {safeStringify(block.input)}
              </pre>
            </div>
            {block.result !== undefined && (
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: "0.64rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "rgba(240,242,255,0.35)", marginBottom: "0.2rem" }}>
                  Result
                </p>
                <pre style={{ margin: 0, maxWidth: "100%", boxSizing: "border-box", fontSize: "0.7rem", color: "rgba(240,242,255,0.7)", background: "rgba(0,0,0,0.25)", borderRadius: 8, padding: "0.45rem 0.55rem", overflowX: "auto", fontFamily: "var(--font-mono, monospace)" }}>
                  {safeStringify(block.result)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <StepCard
      icon={isAwaitingConfirmation ? ShieldAlert : Wrench}
      iconColor={isAwaitingConfirmation ? "#fbbf24" : undefined}
      title={label}
      subtitle={isAwaitingConfirmation ? "This action needs your confirmation before SOL continues" : undefined}
      status={toStepStatus(block.status)}
    >
      {isAwaitingConfirmation && onConfirm && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <button
            type="button"
            onClick={() => onConfirm("confirmed")}
            disabled={confirmBusy || resolvingConfirmation}
            style={{
              padding: "0.4rem 0.8rem",
              borderRadius: 8,
              border: "none",
              background: "linear-gradient(135deg,var(--brand),var(--brand-deep))",
              color: "#fff",
              fontSize: "0.76rem",
              fontWeight: 700,
              cursor: confirmBusy || resolvingConfirmation ? "not-allowed" : "pointer",
              opacity: confirmBusy || resolvingConfirmation ? 0.6 : 1,
              fontFamily: "inherit",
            }}
          >
            {resolvingConfirmation ? "Preparing…" : confirmBusy ? "Confirming…" : "Confirm"}
          </button>
          <button
            type="button"
            onClick={() => onConfirm("declined")}
            disabled={confirmBusy || resolvingConfirmation}
            style={{
              padding: "0.4rem 0.8rem",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "transparent",
              color: "rgba(240,242,255,0.7)",
              fontSize: "0.76rem",
              fontWeight: 600,
              cursor: confirmBusy || resolvingConfirmation ? "not-allowed" : "pointer",
              opacity: confirmBusy || resolvingConfirmation ? 0.6 : 1,
              fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.25rem",
          background: "none",
          border: "none",
          color: "rgba(240,242,255,0.4)",
          fontSize: "0.7rem",
          cursor: "pointer",
          padding: 0,
          fontFamily: "inherit",
          alignSelf: "flex-start",
        }}
      >
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {expanded ? "Hide details" : "Show details"}
      </button>

      {expanded && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", minWidth: 0, maxWidth: "100%" }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: "0.66rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "rgba(240,242,255,0.35)", marginBottom: "0.2rem" }}>
              Input
            </p>
            <pre style={{ margin: 0, maxWidth: "100%", boxSizing: "border-box", fontSize: "0.72rem", color: "rgba(240,242,255,0.75)", background: "rgba(0,0,0,0.25)", borderRadius: 8, padding: "0.5rem 0.6rem", overflowX: "auto", fontFamily: "var(--font-mono, monospace)" }}>
              {safeStringify(block.input)}
            </pre>
          </div>
          {block.result !== undefined && (
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: "0.66rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "rgba(240,242,255,0.35)", marginBottom: "0.2rem" }}>
                Result
              </p>
              <pre style={{ margin: 0, maxWidth: "100%", boxSizing: "border-box", fontSize: "0.72rem", color: "rgba(240,242,255,0.75)", background: "rgba(0,0,0,0.25)", borderRadius: 8, padding: "0.5rem 0.6rem", overflowX: "auto", fontFamily: "var(--font-mono, monospace)" }}>
                {safeStringify(block.result)}
              </pre>
            </div>
          )}
        </div>
      )}
    </StepCard>
  );
}
