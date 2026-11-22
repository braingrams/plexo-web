"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "./Skeleton";

export type OptimisticLoaderProps = {
  siteName?: string;
  stage?: "finding-designs" | "making-site" | "switching-site" | "loading-assets";
  steps?: string[];
  title?: string;
  subtitle?: string;
  /**
   * "page": a whole screen is loading, so a full page builds itself with the words on top.
   * "inline" (default): part of a screen is loading (a tab, a card, a list), so it shows quiet skeleton shapes in place.
   */
  variant?: "page" | "inline";
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

/** The blocks of the page, in the order they snap into place. Boxes are % of the screen; `from` is where each flies in from (% of its own size, and a tilt). */
const BLOCKS: Array<{ id: string; box: [number, number, number, number]; from: [number, number, number] }> = [
  { id: "nav", box: [2, 2, 96, 9], from: [0, -260, 0] },
  { id: "text", box: [2, 13.5, 47, 40], from: [-170, 20, -6] },
  { id: "image", box: [51, 13.5, 47, 40], from: [170, -30, 8] },
  { id: "card", box: [2, 56, 31, 30], from: [-120, 200, -8] },
  { id: "card", box: [34.5, 56, 31, 30], from: [0, 240, 5] },
  { id: "card", box: [67, 56, 31, 30], from: [120, 200, 9] },
  { id: "foot", box: [2, 88.5, 96, 9.5], from: [0, 280, 0] },
];

/**
 * A whole website building itself across the full screen, block by block like a puzzle clicking together: each piece
 * flies in, snaps into place with a little spring and a flash of brand colour, and when the page is whole it starts
 * over. The words sit on top of it. Something nice to watch instead of a spinner.
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
    }, 520);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="plx-pb" aria-hidden data-whole={placed === BLOCKS.length}>
      {BLOCKS.map((b, i) => (
        <div
          key={i}
          className={`plx-pb__blk plx-pb__blk--${b.id}`}
          data-on={i < placed}
          data-fresh={i === placed - 1}
          style={{ left: `${b.box[0]}%`, top: `${b.box[1]}%`, width: `${b.box[2]}%`, height: `${b.box[3]}%`, ["--fx" as string]: `${b.from[0]}%`, ["--fy" as string]: `${b.from[1]}%`, ["--fr" as string]: `${b.from[2]}deg` }}
        >
          {b.id === "nav" ? <><span className="plx-pb__logo" /><span className="plx-pb__pill" /><span className="plx-pb__pill" /><span className="plx-pb__pill" /><span className="plx-pb__cta" /></> : null}
          {b.id === "text" ? <><span className="plx-pb__h" /><span className="plx-pb__h plx-pb__h--s" /><span className="plx-pb__ln" /><span className="plx-pb__ln plx-pb__ln--s" /><span className="plx-pb__btn" /></> : null}
          {b.id === "card" ? <><span className="plx-pb__dot" /><span className="plx-pb__ln" /><span className="plx-pb__ln plx-pb__ln--s" /></> : null}
        </div>
      ))}
    </div>
  );
}

/** Quiet placeholder shapes for part of a screen; the words are only for screen readers. */
function InlineSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" aria-label={label} className="plx-optimistic-inline" style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%" }}>
      <Skeleton width="38%" height={20} />
      <Skeleton width="72%" height={12} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))", gap: 12 }}>
        <Skeleton height={84} radius={12} />
        <Skeleton height={84} radius={12} />
        <Skeleton height={84} radius={12} />
      </div>
      <Skeleton width="90%" height={12} />
      <Skeleton width="60%" height={12} />
    </div>
  );
}

export function OptimisticLoader(props: OptimisticLoaderProps) {
  if (props.variant === "page") return <PageLoader {...props} />;
  return <InlineSkeleton label={props.subtitle ?? props.title ?? props.steps?.[0] ?? "Loading"} />;
}

function PageLoader({
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
    <div role="status" aria-live="polite" className="plx-optimistic-loader">
      <PageBuilder />
      <div className="plx-pb__words">
        <h2 className="plx-pb__title">{resolvedTitle}</h2>
        {subtitle ? <p className="plx-pb__sub">{subtitle}</p> : null}
        <p className="plx-pb__cap"><span className="plx-pb__capdot" aria-hidden />{activeStepText}</p>
      </div>

      <style>{`
        @keyframes plx-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .plx-spin { animation: plx-spin 1.2s cubic-bezier(0.4, 0, 0.2, 1) infinite; }
        .plx-optimistic-loader { position: relative; width: 100%; min-height: clamp(440px, calc(100dvh - 120px), 920px); overflow: hidden; border-radius: var(--plx-radius-card-lg, 16px); background: var(--plx-bg); isolation: isolate; }
        .plx-pb { position: absolute; inset: 0; z-index: 0; }
        .plx-pb__blk { position: absolute; display: flex; border-radius: 12px; background: var(--plx-surface); border: 1px solid var(--plx-border); box-shadow: var(--plx-shadow-card); opacity: 0; transform: translate(var(--fx), var(--fy)) rotate(var(--fr)) scale(.75); transition: opacity .2s ease, transform .25s ease-in; padding: clamp(10px, 1.6vw, 20px); gap: clamp(6px, 1vw, 12px); }
        .plx-pb__blk[data-on="true"] { opacity: 1; transform: none; transition: opacity .25s ease, transform .6s cubic-bezier(.34, 1.56, .64, 1); }
        .plx-pb__blk[data-fresh="true"] { animation: plx-pb-snap .7s ease-out; }
        @keyframes plx-pb-snap { 0% { outline: 3px solid var(--plx-brand); outline-offset: 0; } 100% { outline: 3px solid transparent; outline-offset: 8px; } }
        .plx-pb__blk--nav { align-items: center; padding-block: 0; }
        .plx-pb__blk--image { background: linear-gradient(135deg, var(--plx-brand), color-mix(in srgb, var(--plx-brand) 28%, var(--plx-surface))); border-color: transparent; }
        .plx-pb__blk--text { flex-direction: column; justify-content: center; }
        .plx-pb__blk--card { flex-direction: column; justify-content: center; }
        .plx-pb__blk--foot { background: var(--plx-sunken); }
        .plx-pb__logo { width: clamp(40px, 6vw, 80px); height: 40%; max-height: 18px; border-radius: 5px; background: var(--plx-brand); margin-right: auto; }
        .plx-pb__pill { width: clamp(24px, 4vw, 52px); height: 24%; max-height: 8px; border-radius: 4px; background: var(--plx-border-strong); }
        .plx-pb__cta { width: clamp(36px, 6vw, 70px); height: 52%; max-height: 22px; border-radius: 8px; background: var(--plx-brand); }
        .plx-pb__h { height: clamp(14px, 2.4vw, 28px); width: 82%; border-radius: 6px; background: var(--plx-text); opacity: .85; }
        .plx-pb__h--s { width: 56%; }
        .plx-pb__ln { height: clamp(7px, 1vw, 11px); width: 90%; border-radius: 4px; background: var(--plx-border-strong); }
        .plx-pb__ln--s { width: 60%; }
        .plx-pb__btn { height: clamp(16px, 2.4vw, 28px); width: 32%; border-radius: 8px; background: var(--plx-brand); margin-top: 4px; }
        .plx-pb__dot { width: clamp(16px, 2.2vw, 26px); height: clamp(16px, 2.2vw, 26px); border-radius: 50%; background: var(--plx-tint); border: 3px solid var(--plx-brand); }
        .plx-pb__words { position: absolute; z-index: 2; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(460px, calc(100% - 32px)); display: flex; flex-direction: column; gap: 8px; align-items: center; text-align: center; padding: clamp(18px, 3vw, 28px); border-radius: 18px; background: color-mix(in srgb, var(--plx-surface) 82%, transparent); border: 1px solid var(--plx-border-strong); box-shadow: 0 24px 60px -20px color-mix(in srgb, var(--plx-brand) 40%, transparent); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); }
        .plx-pb__title { margin: 0; font-size: clamp(18px, 2.4vw, 22px); font-weight: 700; letter-spacing: -0.015em; color: var(--plx-text); }
        .plx-pb__sub { margin: 0; font-size: 14px; line-height: 1.5; color: var(--plx-muted); }
        .plx-pb__cap { margin: 4px 0 0; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--plx-text); min-height: 20px; }
        .plx-pb__capdot { width: 6px; height: 6px; border-radius: 50%; background: var(--plx-brand); box-shadow: 0 0 6px var(--plx-brand); flex-shrink: 0; }
        @media (prefers-reduced-motion: reduce) { .plx-pb__blk, .plx-pb__blk[data-on="true"] { transition: none; } .plx-pb__blk[data-fresh="true"] { animation: none; } }
      `}</style>
    </div>
  );
}
