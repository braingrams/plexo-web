"use client";

import { useEffect, useRef, useState } from "react";

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

export function setSolLaunchOrigin(x: number, y: number): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ x, y, t: Date.now() }));
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

export function SolEntranceOverlay({ onDone }: { onDone: () => void }) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const shimmerRef = useRef<HTMLDivElement>(null);
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
    // Safety net: if gsap fails to import for any reason, don't block the interface —
    // clear the overlay immediately (still shows a bare instant cut, but never hangs).
    const fallbackTimer = window.setTimeout(() => {
      if (!cancelled) {
        setVisible(false);
        finish();
      }
    }, 1100);

    import("gsap")
      .then(({ gsap }) => {
        if (cancelled) return;
        window.clearTimeout(fallbackTimer);

        const tl = gsap.timeline({
          onComplete: () => {
            if (cancelled) return;
            setVisible(false);
            finish();
          },
        });

        tl.set(overlay, { opacity: 1 });
        tl.set(glow, { scale: 0, opacity: 0 });
        tl.set(shimmer, { opacity: 0 });

        // Radial glow blooms outward from the click origin.
        tl.to(glow, { scale: 1, opacity: 1, duration: 0.42, ease: "power2.out" }, 0);
        // A light shimmer sweep across the overlay while the glow is still expanding.
        tl.to(shimmer, { opacity: 0.5, duration: 0.22, ease: "sine.out" }, 0.08);
        tl.to(shimmer, { opacity: 0, duration: 0.32, ease: "sine.in" }, 0.34);
        // Whole overlay wipes away, revealing the chat view underneath.
        tl.to(overlay, { opacity: 0, duration: 0.38, ease: "power1.inOut" }, 0.5);
        tl.to(glow, { scale: 1.35, duration: 0.38, ease: "power1.out" }, 0.5);
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
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%,-50%)",
          display: "flex",
          alignItems: "center",
          gap: "0.6rem",
          opacity: 0.9,
        }}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
          <path d="M12 2l2.2 6.3L20.5 10.5l-6.3 2.2L12 19l-2.2-6.3L3.5 10.5l6.3-2.2L12 2z" fill="#e9d5ff" opacity="0.9" />
        </svg>
        <span style={{ fontFamily: "var(--font-heading), sans-serif", fontWeight: 700, fontSize: "1.1rem", color: "#f3e8ff", letterSpacing: "0.02em" }}>
          SOL
        </span>
      </div>
    </div>
  );
}
