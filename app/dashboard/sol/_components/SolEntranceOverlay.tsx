"use client";

import { useEffect, useRef, useState } from "react";
import { SolIcon } from "./SolIcon";
import { armSolReadinessGate, waitForSolReadiness } from "./solReadinessGate";

/**
 * A one-shot, full-viewport "entering SOL" reveal — mounted by SolChatView the first time
 * this tab arrives on /dashboard/sol in a given session (see the sessionStorage guard in
 * SolChatView). Reads the click origin the mode-toggle button stashed in sessionStorage
 * (see setSolLaunchOrigin below) and expands a soft radial glow out from that exact point,
 * then wipes away to reveal the real chat view — a deliberate, premium moment, not a
 * loading screen. gsap is progressive enhancement: if it fails to load for any reason, the
 * overlay just skips itself immediately rather than ever blocking input.
 */

const SESSION_KEY = "sol:launchOrigin";
const HANDLED_KEY = "sol:launchHandled";

export function setSolLaunchOrigin(x: number, y: number): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ x, y, t: Date.now() }));
    sessionStorage.removeItem(HANDLED_KEY);
  } catch {
    // sessionStorage can throw in locked-down contexts (private mode, etc.) — the overlay
    // just falls back to centering itself, never worth failing navigation over.
  }
}

function consumeSolLaunchOrigin(): { x: number; y: number } | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(SESSION_KEY);
    const parsed = JSON.parse(raw) as { x: number; y: number; t: number };
    // Stale beyond a couple seconds (e.g. a bookmarked/refreshed /dashboard/sol URL, not an
    // actual toggle-button click just now) — don't replay an animation for that.
    if (Date.now() - parsed.t > 4000) return null;
    return { x: parsed.x, y: parsed.y };
  } catch {
    return null;
  }
}

/** Called by SolModeSwitch the instant it renders ITS OWN copy of this overlay (via a
 * portal, from the dashboard page itself, before any navigation even starts — see that
 * file's own comment for why). Marks the transition as already being animated so
 * SolShellInner's copy (mounted later, only once the destination route has actually
 * loaded) knows to skip itself entirely instead of stacking a second, independently-timed
 * overlay on top of the first. */
export function markSolTransitionHandled(): void {
  try {
    sessionStorage.setItem(HANDLED_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

export function wasSolTransitionHandledRecently(): boolean {
  try {
    const raw = sessionStorage.getItem(HANDLED_KEY);
    if (!raw) return false;
    return Date.now() - Number(raw) < 4000;
  } catch {
    return false;
  }
}

export function SolEntranceOverlay({ onDone }: { onDone: () => void }) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const shimmerRef = useRef<HTMLDivElement>(null);
  const wordmarkRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  const doneRef = useRef(false);

  useEffect(() => {
    const finish = () => {
      if (doneRef.current) return;
      doneRef.current = true;
      onDone();
    };

    const prefersReducedMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) {
      setVisible(false);
      finish();
      return;
    }

    const origin = consumeSolLaunchOrigin();
    const overlay = overlayRef.current;
    const glow = glowRef.current;
    const shimmer = shimmerRef.current;
    const wordmark = wordmarkRef.current;
    if (!overlay || !glow) {
      finish();
      return;
    }

    if (origin) {
      glow.style.left = `${origin.x}px`;
      glow.style.top = `${origin.y}px`;
    } else {
      glow.style.left = "50%";
      glow.style.top = "50%";
    }

    let cancelled = false;
    // Fresh wait cycle for THIS entrance — see solReadinessGate.ts. Must happen
    // synchronously here, before the destination route's ThreadSidebar/Greeting have any
    // chance to mount and register themselves, so there's no window where a leftover
    // "already resolved" state from a previous visit to SOL makes this arrival look
    // falsely ready before its own data has even started loading.
    armSolReadinessGate();

    // Safety net: if gsap fails to import for any reason, don't block the interface —
    // clear the overlay immediately (still shows a bare instant cut, but never hangs).
    // Comfortably longer than the bloom-in phase below (~1s) so it never fires under
    // normal conditions, only as a genuine fallback.
    const fallbackTimer = window.setTimeout(() => {
      if (!cancelled) {
        setVisible(false);
        finish();
      }
    }, 2600);

    import("gsap")
      .then(({ gsap }) => {
        if (cancelled) return;
        window.clearTimeout(fallbackTimer);

        // Phase 1: the glow blooms out from the click origin and the wordmark pops in —
        // this part always plays in full, giving an immediate "something is happening"
        // moment regardless of how long the real page takes to load underneath.
        const tl1 = gsap.timeline();

        tl1.set(overlay, { opacity: 1 });
        tl1.set(glow, { scale: 0, opacity: 0 });
        tl1.set(shimmer, { opacity: 0 });
        if (wordmark) tl1.set(wordmark, { opacity: 0, scale: 0.85, y: 8 });

        // Radial glow blooms outward from the click origin — slower and more deliberate
        // than a quick flash, since this is meant to actually be seen, not just glimpsed.
        tl1.to(glow, { scale: 1, opacity: 1, duration: 0.65, ease: "power2.out" }, 0);
        // A light shimmer sweep across the overlay while the glow is still expanding.
        tl1.to(shimmer, { opacity: 0.45, duration: 0.3, ease: "sine.out" }, 0.15);
        tl1.to(shimmer, { opacity: 0, duration: 0.4, ease: "sine.in" }, 0.5);
        // The SOL wordmark pops in with a touch of overshoot once the glow has room for it.
        if (wordmark) tl1.to(wordmark, { opacity: 1, scale: 1, y: 0, duration: 0.5, ease: "back.out(1.6)" }, 0.45);

        tl1.eventCallback("onComplete", () => {
          if (cancelled) return;

          // Phase 2 only starts once the destination view's real data — the Recents list,
          // and (on the empty-chat state) the greeting's name — has actually finished
          // loading, not on a fixed timer: this is the whole point of the redesign, so the
          // overlay never wipes away onto a half-loaded page. `MIN_HOLD_MS` keeps a small
          // deliberate beat even when data resolves instantly (most of the time, given how
          // fast these fetches typically are), so the reveal never reads as a jump-cut;
          // `MAX_EXTRA_WAIT_MS` is a safety ceiling for a genuinely broken/slow fetch, not
          // the expected path.
          const MIN_HOLD_MS = 350;
          const MAX_EXTRA_WAIT_MS = 6000;
          void Promise.all([
            waitForSolReadiness(MAX_EXTRA_WAIT_MS),
            new Promise((resolve) => window.setTimeout(resolve, MIN_HOLD_MS)),
          ]).then(() => {
            if (cancelled) return;

            const tl2 = gsap.timeline({
              onComplete: () => {
                if (cancelled) return;
                setVisible(false);
                finish();
              },
            });
            // Wordmark settles, then the whole overlay wipes away to reveal the chat view.
            if (wordmark) tl2.to(wordmark, { opacity: 0, scale: 1.05, duration: 0.3, ease: "power1.in" }, 0);
            tl2.to(overlay, { opacity: 0, duration: 0.4, ease: "power1.inOut" }, 0.05);
            tl2.to(glow, { scale: 1.35, duration: 0.4, ease: "power1.out" }, 0.05);
          });
        });
      })
      .catch(() => {
        if (!cancelled) {
          window.clearTimeout(fallbackTimer);
          setVisible(false);
          finish();
        }
      });

    return () => {
      cancelled = true;
      window.clearTimeout(fallbackTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!visible) return null;

  return (
    <div
      ref={overlayRef}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        pointerEvents: "none",
        background: "radial-gradient(120% 120% at 50% 0%, #14071f 0%, #08040f 55%, #030207 100%)",
        overflow: "hidden",
      }}
    >
      <div
        ref={glowRef}
        style={{
          position: "absolute",
          width: "180vmax",
          height: "180vmax",
          transform: "translate(-50%, -50%)",
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(168,85,247,0.55) 0%, rgba(139,92,246,0.32) 22%, rgba(76,29,149,0.14) 42%, rgba(8,4,15,0) 68%)",
          willChange: "transform, opacity",
        }}
      />
      <div
        ref={shimmerRef}
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(115deg, transparent 35%, rgba(255,255,255,0.16) 50%, transparent 65%)",
          mixBlendMode: "screen",
        }}
      />
      <div
        ref={wordmarkRef}
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%,-50%)",
          display: "flex",
          alignItems: "center",
          gap: "0.7rem",
        }}
      >
        <div style={{ color: "#e9d5ff" }}>
          <SolIcon size={30} />
        </div>
        <span style={{ fontFamily: "var(--font-heading), sans-serif", fontWeight: 700, fontSize: "1.35rem", color: "#f3e8ff", letterSpacing: "0.03em" }}>
          SOL
        </span>
      </div>
    </div>
  );
}
