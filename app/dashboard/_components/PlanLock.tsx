"use client";

import { useState, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { useMyPlan } from "./trial";
import { UpgradePrompt } from "./UpgradePrompt";
import { PLAN_LABELS, PLAN_RANK, type PaidPlanId } from "@/lib/plan/plans";

/**
 * A control that a bigger plan unlocks. Instead of a dead, greyed-out control it keeps looking
 * like itself with a small lock and the plan's name; pressing it opens the upgrade prompt right
 * beneath it (with the free trial while it's unused, and a way back to this exact page).
 *
 * `locked` can be passed when the screen already knows (the server decided); otherwise the
 * account's plan is compared with `requires`.
 */
export function PlanLock({
  requires,
  message,
  locked,
  returnTo,
  children,
}: {
  requires: PaidPlanId;
  /** What this needs, in plain words — shown with the upgrade button. */
  message: string;
  locked?: boolean;
  returnTo?: string;
  children: ReactNode;
}) {
  const my = useMyPlan();
  const [open, setOpen] = useState(false);
  const isLocked = locked ?? (my.plan !== null && PLAN_RANK[my.plan] < PLAN_RANK[requires]);
  if (!isLocked) return <>{children}</>;

  const toggle = (e: { preventDefault: () => void; stopPropagation: () => void }) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen((o) => !o);
  };
  return (
    <div data-plan-lock={requires} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <div
        onClickCapture={toggle}
        onKeyDownCapture={(e) => (e.key === "Enter" || e.key === " ") && toggle(e)}
        style={{ position: "relative", cursor: "pointer" }}
      >
        <div style={{ opacity: 0.72, pointerEvents: "none" }} aria-hidden={false}>{children}</div>
        <span
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "0.12rem 0.5rem",
            borderRadius: 999,
            fontSize: "0.68rem",
            fontWeight: 700,
            background: "color-mix(in srgb, currentColor 14%, transparent)",
            color: "inherit",
          }}
        >
          <Lock size={11} aria-hidden /> {PLAN_LABELS[requires]}
        </span>
      </div>
      {open && <UpgradePrompt message={message} requiredPlan={requires} returnTo={returnTo} tone="info" />}
    </div>
  );
}
