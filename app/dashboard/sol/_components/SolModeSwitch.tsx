"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ArrowRight, LayoutGrid } from "lucide-react";
import { setSolLaunchOrigin, markSolTransitionHandled, SolEntranceOverlay } from "./SolEntranceOverlay";
import { SolIcon } from "./SolIcon";

/**
 * The one control for moving between the ordinary Plexo dashboard and SOL — a segmented
 * switch (not a plain nav button) so which side you're on is always visually obvious, used
 * in both dashboard shells' top bars (active: "plexo") and inside SolHeader (active: "sol").
 *
 * Replaces two previously-separate, asymmetric pieces:
 * - SolToggleButton (entering SOL only) — folded in here as the "SOL" segment.
 * - SolHeader's plain "← Dashboard" button, which navigated to /dashboard WITHOUT ever
 *   updating the user's saved preferredSurface — since /dashboard's own server-side
 *   redirect (app/dashboard/page.tsx) sends anyone with preferredSurface==="SOL" straight
 *   back into SOL, that missing PATCH was a real bug: leaving SOL always bounced you right
 *   back. Fixed here by AWAITING the preference save before navigating away from SOL,
 *   instead of firing it and moving on — the redirect check can only ever see the new value
 *   by the time the dashboard page actually loads.
 *
 * The "plexo"-side instances of this switch (the ones in the dashboard shells) ALSO own
 * rendering the entrance overlay themselves, via a portal, the instant the click happens —
 * BEFORE `router.push` is even called. This is deliberate: the destination route
 * (/dashboard/sol) needs its own Server Components to resolve (auth, org, DynamoDB reads)
 * before any of ITS code — including SolShell's own copy of this overlay — exists at all,
 * which is exactly the gap where Next.js's own loading.tsx / route-transition skeleton can
 * show through first. This component is already mounted on the CURRENT (dashboard) page
 * when clicked, so its overlay can appear with zero dependency on how fast the destination
 * loads, fully masking that entire transition. See SolShellInner's own comment for how it
 * avoids double-playing this when it mounts afterward.
 */
const TRIED_KEY = "sol:tried";

export function SolModeSwitch({
  active,
  compact = false,
  sidebarCard = false,
}: {
  active: "plexo" | "sol";
  compact?: boolean;
  /** Renders as a full-width, prominent nav-style card (icon + "SOL AI Agent" + an "AI"
   * badge) instead of the segmented Plexo/SOL pill — for Classic's fixed sidebar, sitting
   * above its ordinary nav list, where the topbar's own switch turned out not to be
   * discoverable enough. Only meaningful for `active="plexo"` (there's no reason to show
   * "enter SOL" while already in SOL); reuses the exact same enterSol/transition-overlay
   * logic as every other variant here rather than duplicating it. */
  sidebarCard?: boolean;
}) {
  const router = useRouter();
  const [switching, setSwitching] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  // "Try it now" only ever makes sense as a first-time nudge — once someone has actually
  // been to SOL, the switch itself (highlighted, labeled) is enough of a reminder, and a
  // permanent "try it" caption next to a feature they already use daily would just read as
  // nagging. Persisted in localStorage (not sessionStorage) so it stays gone across visits
  // once earned, not just for the current tab session.
  const [tried, setTried] = useState(true);
  useEffect(() => {
    try {
      setTried(localStorage.getItem(TRIED_KEY) === "1");
    } catch {
      // Locked-down storage (private mode, etc.) — default to "tried" so the nudge just
      // never shows rather than risk it showing forever with no way to persist dismissal.
    }
  }, []);
  useEffect(() => {
    if (active !== "sol") return;
    try {
      localStorage.setItem(TRIED_KEY, "1");
    } catch {
      // Best-effort — worst case the nudge reappears next visit, not worth failing over.
    }
    setTried(true);
  }, [active]);

  function enterSol(e: React.MouseEvent<HTMLButtonElement>) {
    if (active === "sol") return;
    const rect = e.currentTarget.getBoundingClientRect();
    setSolLaunchOrigin(rect.left + rect.width / 2, rect.top + rect.height / 2);
    markSolTransitionHandled();
    setTransitioning(true);
    router.push("/dashboard/sol");
    // Fire-and-forget is fine in this direction — /dashboard/sol has no preference-gated
    // redirect of its own, so there's no race to lose.
    fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferredSurface: "SOL" }),
    }).catch(() => {});
  }

  async function exitToPlexo() {
    if (active === "plexo" || switching) return;
    setSwitching(true);
    try {
      await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferredSurface: "DASHBOARD" }),
      });
    } catch {
      // Best-effort — still navigate even if the save failed, rather than trap the user
      // inside SOL; worst case the redirect bounces them back and they can retry.
    }
    router.push("/dashboard");
  }

  if (sidebarCard) {
    if (active !== "plexo") return null;
    return (
      <>
        <button
          type="button"
          onClick={enterSol}
          disabled={switching}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.65rem",
            width: "100%",
            padding: "0.65rem 0.75rem",
            borderRadius: 12,
            marginBottom: "0.9rem",
            border: "1px solid rgba(168,85,247,0.35)",
            background: "linear-gradient(135deg, rgba(168,85,247,0.22), rgba(124,58,237,0.14))",
            boxShadow: "0 0 24px -10px rgba(168,85,247,0.55)",
            cursor: switching ? "not-allowed" : "pointer",
            fontFamily: "inherit",
            textAlign: "left",
            opacity: switching ? 0.6 : 1,
          }}
        >
          <span
            style={{
              display: "grid",
              placeItems: "center",
              width: 28,
              height: 28,
              borderRadius: 8,
              background: "linear-gradient(135deg, #c084fc, #7c3aed)",
              color: "#fff",
              flexShrink: 0,
            }}
          >
            <SolIcon size={16} />
          </span>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: "0.85rem",
              fontWeight: 600,
              color: "#f3e8ff",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            SOL AI Agent
          </span>
          <span
            style={{
              fontSize: "0.62rem",
              fontWeight: 700,
              padding: "0.15rem 0.45rem",
              borderRadius: 999,
              background: "rgba(255,255,255,0.18)",
              color: "#f3e8ff",
              flexShrink: 0,
            }}
          >
            AI
          </span>
        </button>
        {transitioning && typeof document !== "undefined"
          ? createPortal(<SolEntranceOverlay onDone={() => setTransitioning(false)} />, document.body)
          : null}
      </>
    );
  }

  if (compact) {
    // Icon-only fallback for a collapsed/narrow rail (e.g. Classic layout's collapsed
    // sidebar) — a two-label switch simply doesn't fit there. Toggles the opposite side.
    const goingTo = active === "plexo" ? "sol" : "plexo";
    return (
      <button
        type="button"
        onClick={(e) => (goingTo === "sol" ? enterSol(e) : void exitToPlexo())}
        disabled={switching}
        aria-label={goingTo === "sol" ? "Switch to SOL" : "Switch to Plexo dashboard"}
        title={goingTo === "sol" ? "Switch to SOL" : "Switch to Plexo dashboard"}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 32,
          height: 32,
          borderRadius: 9,
          border: active === "sol" ? "1px solid rgba(168,85,247,0.28)" : "1px solid rgba(255,255,255,0.08)",
          background: active === "sol" ? "linear-gradient(135deg, rgba(168,85,247,0.18), rgba(124,58,237,0.1))" : "rgba(255,255,255,0.04)",
          color: active === "sol" ? "#e9d5ff" : "rgba(240,242,255,0.6)",
          cursor: "pointer",
          flexShrink: 0,
          opacity: switching ? 0.6 : 1,
        }}
      >
        {active === "sol" ? <SolIcon size={15} /> : <LayoutGrid size={14} />}
      </button>
    );
  }

  const segmentBase: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.35rem",
    padding: "0.34rem 0.7rem",
    borderRadius: 8,
    border: "none",
    fontSize: "0.76rem",
    fontWeight: 700,
    fontFamily: "inherit",
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "color 0.15s ease",
  };

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem" }}>
      {/* First-time nudge toward the new feature — gone for good the moment someone has
          actually been to SOL once (see the `tried` effect above), so this never lingers
          as noise for people who already use it. */}
      {!tried && active === "plexo" && (
        <span
          className="sol-try-nudge"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.3rem",
            fontSize: "0.74rem",
            fontWeight: 700,
            color: "#e9d5ff",
            whiteSpace: "nowrap",
          }}
        >
          Try it now
          <ArrowRight size={12} />
        </span>
      )}
      <div
        role="group"
        aria-label="Switch interface"
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: 3,
          borderRadius: 11,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={() => void exitToPlexo()}
          disabled={switching}
          aria-pressed={active === "plexo"}
          title="Plexo dashboard"
          style={{
            ...segmentBase,
            background: active === "plexo" ? "rgba(255,255,255,0.1)" : "transparent",
            color: active === "plexo" ? "#f0f2ff" : "rgba(240,242,255,0.45)",
            opacity: switching ? 0.6 : 1,
          }}
        >
          <LayoutGrid size={12} />
          Plexo
        </button>
        <button
          type="button"
          onClick={enterSol}
          aria-pressed={active === "sol"}
          title="SOL — your AI agent"
          style={{
            ...segmentBase,
            background: active === "sol" ? "linear-gradient(135deg, rgba(168,85,247,0.32), rgba(124,58,237,0.22))" : "transparent",
            color: active === "sol" ? "#f3e8ff" : "rgba(240,242,255,0.45)",
            boxShadow: active === "sol" ? "0 0 12px rgba(168,85,247,0.25)" : "none",
          }}
        >
          <SolIcon size={13} />
          SOL
        </button>
      </div>

      {transitioning && typeof document !== "undefined"
        ? createPortal(<SolEntranceOverlay onDone={() => setTransitioning(false)} />, document.body)
        : null}

      {!tried && active === "plexo" && (
        <style>{`
          @keyframes sol-try-nudge-pulse {
            0%, 100% { opacity: 0.65; transform: translateX(0); }
            50% { opacity: 1; transform: translateX(2px); }
          }
          .sol-try-nudge { animation: sol-try-nudge-pulse 1.6s ease-in-out infinite; }
        `}</style>
      )}
    </div>
  );
}
