"use client";

import { useEffect, useState } from "react";

export type OptimisticLoaderProps = {
  siteName?: string;
  stage?: "finding-designs" | "making-site" | "switching-site" | "loading-assets";
  steps?: string[];
  title?: string;
  subtitle?: string;
};

const DEFAULT_STEPS: Record<string, (name: string) => string[]> = {
  "finding-designs": (name) => [
    "Putting together your brand data…",
    `Looking for the best templates that represent ${name || "your brand"} properly…`,
    "Matching design styles, palettes, and typography…",
    "Preparing your high-res interactive preview…",
  ],
  "making-site": (name) => [
    `Saving brand details for ${name || "your website"}…`,
    "Generating responsive pages and interactive blocks…",
    "Setting up design tokens and assets in the background…",
    "Polishing everything up for your first edit…",
  ],
  "switching-site": (name) => [
    `Switching workspace context to ${name || "your site"}…`,
    "Loading pages, settings, and features…",
    "Ready!",
  ],
  "loading-assets": (name) => [
    "Loading assets and styles…",
    `Configuring canvas for ${name || "your website"}…`,
  ],
};

/** The blocks of the little page, in the order they snap into place. Positions are % of the frame; --fx/--fy/--fr are where each flies in from. */
const BLOCKS: Array<{ id: string; box: [number, number, number, number]; from: [number, number, number] }> = [
  { id: "nav", box: [4, 5, 92, 11], from: [0, -60, 0] },
  { id: "image", box: [60, 20, 36, 34], from: [90, -20, 12] },
  { id: "text", box: [4, 20, 52, 34], from: [-90, 10, -8] },
  { id: "card", box: [4, 58, 29, 24], from: [-40, 80, -10] },
  { id: "card", box: [35.5, 58, 29, 24], from: [0, 90, 6] },
  { id: "card", box: [67, 58, 29, 24], from: [50, 80, 12] },
  { id: "foot", box: [4, 86, 92, 8], from: [0, 60, 0] },
];

/**
 * A tiny website that builds itself, block by block, like a puzzle clicking together: each piece
 * flies in, snaps into place with a little spring and a flash of brand colour, and when the page
 * is whole it starts over. Something nice to watch instead of a spinner.
 */
function PageBuilder() {
  const [placed, setPlaced] = useState(0);
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setPlaced(BLOCKS.length);
      return;
    }
    let tick = 0;
    const timer = setInterval(() => {
      tick = (tick + 1) % (BLOCKS.length + 4);
      setPlaced(Math.min(tick, BLOCKS.length));
    }, 480);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="plx-pb" aria-hidden data-whole={placed === BLOCKS.length}>
      <div className="plx-pb__bar"><i /><i /><i /></div>
      <div className="plx-pb__page">
        <div className="plx-pb__ghost" />
        {BLOCKS.map((b, i) => (
          <div
            key={i}
            className={`plx-pb__blk plx-pb__blk--${b.id}`}
            data-on={i < placed}
            data-fresh={i === placed - 1}
            style={{ left: `${b.box[0]}%`, top: `${b.box[1]}%`, width: `${b.box[2]}%`, height: `${b.box[3]}%`, ["--fx" as string]: `${b.from[0]}px`, ["--fy" as string]: `${b.from[1]}px`, ["--fr" as string]: `${b.from[2]}deg` }}
          >
            {b.id === "nav" ? <><span className="plx-pb__logo" /><span className="plx-pb__pill" /><span className="plx-pb__pill" /><span className="plx-pb__pill" /></> : null}
            {b.id === "text" ? <><span className="plx-pb__h" /><span className="plx-pb__h plx-pb__h--s" /><span className="plx-pb__ln" /><span className="plx-pb__ln plx-pb__ln--s" /><span className="plx-pb__btn" /></> : null}
            {b.id === "card" ? <><span className="plx-pb__dot" /><span className="plx-pb__ln" /><span className="plx-pb__ln plx-pb__ln--s" /></> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function OptimisticLoader({
  siteName = "your site",
  stage = "finding-designs",
  steps: customSteps,
  title,
  subtitle,
}: OptimisticLoaderProps) {
  const steps = customSteps ?? (DEFAULT_STEPS[stage] ? DEFAULT_STEPS[stage](siteName) : DEFAULT_STEPS["finding-designs"](siteName));
  // The captions keep rotating (never settling on "ready"): the screen disappears by itself when the page is ready.
  const rotating = steps.length > 1 ? steps.slice(0, -1) : steps;
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  useEffect(() => {
    if (rotating.length < 2) return;
    const timer = setInterval(() => setCurrentStepIndex((prev) => (prev + 1) % rotating.length), 1800);
    return () => clearInterval(timer);
  }, [rotating.length]);

  const activeStepText = rotating[currentStepIndex % rotating.length];
  const resolvedTitle = title ?? (stage === "making-site" ? `Making ${siteName}…` : stage === "finding-designs" ? `Finding the best look for ${siteName}…` : "Constructing your workspace…");

  return (
    <div
      role="status"
      aria-live="polite"
      className="plx-optimistic-loader"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 24px",
        textAlign: "center",
        gap: 20,
        maxWidth: 520,
        margin: "0 auto",
        width: "100%",
      }}
    >
      <PageBuilder />

      {/* Main title & subtitle with refined typography */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
        <h2
          style={{
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: "-0.015em",
            color: "var(--plx-text)",
            margin: 0,
          }}
        >
          {resolvedTitle}
        </h2>
        {subtitle ? (
          <p
            style={{
              fontSize: 14,
              color: "var(--plx-muted)",
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            {subtitle}
          </p>
        ) : null}
      </div>

      {/* Refined construction progression track */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          width: "100%",
          maxWidth: 380,
          margin: "4px auto 0",
        }}
      >
        {/* Active construction milestone */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            minHeight: 22,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              textAlign: "left",
              minWidth: 0,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--plx-brand)",
                boxShadow: "0 0 6px var(--plx-brand)",
                flexShrink: 0,
              }}
              aria-hidden
            />
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--plx-text)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                transition: "opacity 0.2s ease",
              }}
            >
              {activeStepText}
            </span>
          </div>

        </div>
      </div>

      <style>{`
        @keyframes plx-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .plx-spin { animation: plx-spin 1.2s cubic-bezier(0.4, 0, 0.2, 1) infinite; }
        .plx-pb { width: min(300px, 78vw); border-radius: 14px; background: var(--plx-surface); border: 1px solid var(--plx-border-strong); box-shadow: 0 18px 40px -18px color-mix(in srgb, var(--plx-brand) 45%, transparent); overflow: hidden; transition: box-shadow .4s ease; }
        .plx-pb[data-whole="true"] { box-shadow: 0 18px 46px -12px color-mix(in srgb, var(--plx-brand) 70%, transparent); }
        .plx-pb__bar { display: flex; gap: 5px; padding: 8px 10px; background: var(--plx-sunken); border-bottom: 1px solid var(--plx-border); }
        .plx-pb__bar i { width: 7px; height: 7px; border-radius: 50%; background: var(--plx-border-strong); }
        .plx-pb__page { position: relative; aspect-ratio: 16 / 10; background: var(--plx-bg); overflow: hidden; }
        .plx-pb__ghost { position: absolute; inset: 4%; border-radius: 8px; border: 1.5px dashed var(--plx-border-strong); opacity: .7; }
        .plx-pb__blk { position: absolute; display: flex; border-radius: 7px; background: var(--plx-surface); border: 1px solid var(--plx-border); box-shadow: var(--plx-shadow-card); opacity: 0; transform: translate(var(--fx), var(--fy)) rotate(var(--fr)) scale(.7); transition: opacity .2s ease, transform .22s ease-in; padding: 5px 7px; gap: 4px; }
        .plx-pb__blk[data-on="true"] { opacity: 1; transform: none; transition: opacity .25s ease, transform .55s cubic-bezier(.34, 1.56, .64, 1); }
        .plx-pb__blk[data-fresh="true"] { animation: plx-pb-snap .6s ease-out; }
        @keyframes plx-pb-snap { 0% { outline: 2px solid var(--plx-brand); outline-offset: 0; } 100% { outline: 2px solid transparent; outline-offset: 5px; } }
        .plx-pb__blk--nav { align-items: center; padding: 0 8px; }
        .plx-pb__blk--image { background: linear-gradient(135deg, var(--plx-brand), color-mix(in srgb, var(--plx-brand) 30%, var(--plx-surface))); border-color: transparent; }
        .plx-pb__blk--text { flex-direction: column; justify-content: center; gap: 5px; }
        .plx-pb__blk--card { flex-direction: column; justify-content: center; gap: 4px; }
        .plx-pb__blk--foot { background: var(--plx-sunken); }
        .plx-pb__logo { width: 16px; height: 7px; border-radius: 3px; background: var(--plx-brand); margin-right: auto; }
        .plx-pb__pill { width: 14px; height: 4px; border-radius: 2px; background: var(--plx-border-strong); }
        .plx-pb__h { height: 8px; width: 80%; border-radius: 3px; background: var(--plx-text); opacity: .85; }
        .plx-pb__h--s { width: 55%; }
        .plx-pb__ln { height: 4px; width: 90%; border-radius: 2px; background: var(--plx-border-strong); }
        .plx-pb__ln--s { width: 60%; }
        .plx-pb__btn { height: 9px; width: 34%; border-radius: 5px; background: var(--plx-brand); margin-top: 2px; }
        .plx-pb__dot { width: 10px; height: 10px; border-radius: 50%; background: var(--plx-tint); border: 2px solid var(--plx-brand); }
        @media (prefers-reduced-motion: reduce) { .plx-pb__blk, .plx-pb__blk[data-on="true"] { transition: none; } .plx-pb__blk[data-fresh="true"] { animation: none; } }
      `}</style>
    </div>
  );
}
