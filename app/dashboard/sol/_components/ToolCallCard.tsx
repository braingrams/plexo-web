"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, ShieldAlert, Wrench } from "lucide-react";
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

/** Renders one tool_use/tool_result pair as a single card. Destructive calls (the ones
 * SOL paused on for confirmation) render inline Confirm/Cancel buttons; everything else
 * just shows a plain status progression pending -> running -> done/error. */
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
  const label = block.label || block.name;

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
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <div>
            <p style={{ fontSize: "0.66rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "rgba(240,242,255,0.35)", marginBottom: "0.2rem" }}>
              Input
            </p>
            <pre style={{ margin: 0, fontSize: "0.72rem", color: "rgba(240,242,255,0.75)", background: "rgba(0,0,0,0.25)", borderRadius: 8, padding: "0.5rem 0.6rem", overflowX: "auto", fontFamily: "var(--font-mono, monospace)" }}>
              {safeStringify(block.input)}
            </pre>
          </div>
          {block.result !== undefined && (
            <div>
              <p style={{ fontSize: "0.66rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "rgba(240,242,255,0.35)", marginBottom: "0.2rem" }}>
                Result
              </p>
              <pre style={{ margin: 0, fontSize: "0.72rem", color: "rgba(240,242,255,0.75)", background: "rgba(0,0,0,0.25)", borderRadius: 8, padding: "0.5rem 0.6rem", overflowX: "auto", fontFamily: "var(--font-mono, monospace)" }}>
                {safeStringify(block.result)}
              </pre>
            </div>
          )}
        </div>
      )}
    </StepCard>
  );
}
