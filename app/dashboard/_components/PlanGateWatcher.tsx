"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { isActionGateFailure, isGateShown, rememberPlanGate, type PlanGate } from "@/lib/plan/planGate";
import { UpgradePrompt } from "./UpgradePrompt";

// The safety net behind every plan limit. Screens show the upgrade prompt where they can
// (inline, where the owner is looking), but there are a lot of screens: if an action fails on
// a plan limit and nothing on the page is explaining it, this opens the same prompt in a
// dialog, so a limit is never a dead end that just says "403". It also notes the limit so any
// screen's error spot can swap its bare text for the prompt (GateOrError).

const EVENT = "plx:plan-gate";
const SAME_LIMIT_QUIET_MS = 15_000;

function installFetchWatcher(): void {
  const w = window as unknown as { __plxGateWatch?: boolean };
  if (w.__plxGateWatch) return;
  w.__plxGateWatch = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await original(input, init);
    try {
      if (!res.ok && (res.status === 402 || res.status === 403)) {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.href);
        if (url.origin === window.location.origin && url.pathname.startsWith("/api/")) {
          const method = init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET");
          void res
            .clone()
            .json()
            .then((body: unknown) => {
              const gate = rememberPlanGate(body);
              if (gate && isActionGateFailure(method, res.status)) window.dispatchEvent(new CustomEvent<PlanGate>(EVENT, { detail: gate }));
            })
            .catch(() => undefined);
        }
      }
    } catch {
      /* the watcher must never break a request */
    }
    return res;
  };
}

export function PlanGateWatcher() {
  const [gate, setGate] = useState<PlanGate | null>(null);

  useEffect(() => {
    installFetchWatcher();
    const lastShown = new Map<string, number>();
    const onGate = (event: Event) => {
      const next = (event as CustomEvent<PlanGate>).detail;
      // Give the screen a moment to show its own prompt; only step in when nothing did.
      window.setTimeout(() => {
        if (isGateShown(next.message)) return;
        const last = lastShown.get(next.message) ?? 0;
        if (Date.now() - last < SAME_LIMIT_QUIET_MS) return;
        lastShown.set(next.message, Date.now());
        setGate(next);
      }, 450);
    };
    window.addEventListener(EVENT, onGate);
    return () => window.removeEventListener(EVENT, onGate);
  }, []);

  if (!gate) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Upgrade"
      onClick={() => setGate(null)}
      style={{ position: "fixed", inset: 0, zIndex: 900, display: "grid", placeItems: "center", padding: "1rem", background: "var(--plx-overlay, color-mix(in srgb, black 55%, transparent))" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(100%, 28rem)", position: "relative", borderRadius: 14, padding: "0.5rem", background: "var(--plx-surface, var(--bg))", border: "1px solid var(--plx-border, color-mix(in srgb, currentColor 18%, transparent))" }}
      >
        <button type="button" aria-label="Close" onClick={() => setGate(null)} style={{ position: "absolute", top: 10, right: 10, zIndex: 1, background: "none", border: "none", cursor: "pointer", color: "inherit", opacity: 0.6 }}>
          <X size={16} />
        </button>
        <UpgradePrompt message={gate.message} requiredPlan={gate.requiredPlan} />
      </div>
    </div>
  );
}
