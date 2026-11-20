"use client";

import { UpgradePrompt } from "../../_components/UpgradePrompt";
import type { PlanGate } from "@/lib/plan/planGate";

/** Shown in the publish window when the plan stops the site going live: why, and exactly three ways forward. */
export function PublishBlockedPanel({
  gate,
  returnTo,
  busy,
  onBeforeUpgrade,
  onReplace,
  onUseFreeAddress,
  onSkip,
}: {
  gate: PlanGate & { liveSiteNames?: string[]; canReplace?: boolean };
  returnTo: string;
  busy: boolean;
  onBeforeUpgrade: () => void;
  onReplace: () => void;
  onUseFreeAddress: () => void;
  onSkip: () => void;
}) {
  const other = gate.liveSiteNames?.[0];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
      <p style={{ margin: 0, fontSize: "0.85rem", fontWeight: 700, color: "var(--ed-text)" }}>This site can&apos;t go live yet</p>
      <UpgradePrompt message={gate.message} requiredPlan={gate.requiredPlan} returnTo={returnTo} onBeforeUpgrade={onBeforeUpgrade} />
      {gate.canReplace && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          <button type="button" className="btn-secondary" disabled={busy} onClick={onReplace} style={{ padding: "0.55rem" }}>
            {busy ? "Publishing…" : "Publish and replace the live site"}
          </button>
          <span style={{ fontSize: "0.72rem", color: "var(--ed-t-550)" }}>
            {other ? `"${other}"` : "The site that is live now"} goes offline. Nothing is deleted, and an upgrade brings it back.
          </span>
        </div>
      )}
      {!gate.canReplace && gate.code === "PLAN_CUSTOM_DOMAIN_REQUIRES_UPGRADE" && (
        <button type="button" className="btn-secondary" onClick={onUseFreeAddress} style={{ padding: "0.55rem" }}>Use a free Plexo address instead</button>
      )}
      <button type="button" onClick={onSkip} className="btn-secondary" style={{ padding: "0.55rem", background: "transparent", border: "none", color: "var(--ed-t-550)" }}>Skip for now</button>
    </div>
  );
}
