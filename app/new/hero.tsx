"use client";

import Link from "next/link";
import { useRef } from "react";
import { ArrowRight, Wand2, MousePointerClick, Mail, LayoutTemplate } from "lucide-react";
import { Reveal, gsap, useGSAP, useReducedMotion } from "../scroll-fx";

// Nav is ~112px tall (top banner + main row); the hero is sized to fill the rest of the
// viewport minus that and an extra 300px of breathing room, per design direction.
const NAV_HEIGHT = 112;
const HERO_TRIM = 300;

/**
 * Full-viewport-minus-nav hero: left-aligned headline/subtext/single-CTA, and a right-side
 * fan of 3 tilted mock panels (web / canvas / email) stacked like falling cards — one
 * tilted left, one dead center, one tilted right — each floating independently.
 */
export function Hero() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const leftCardRef = useRef<HTMLDivElement>(null);
  const centerCardRef = useRef<HTMLDivElement>(null);
  const rightCardRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useGSAP(
    () => {
      if (reducedMotion || !sectionRef.current) return;

      // Parallax: the gradient panel drifts slower than the page scrolls past the hero.
      if (bgRef.current) {
        gsap.to(bgRef.current, {
          y: 50,
          ease: "none",
          scrollTrigger: { trigger: sectionRef.current, start: "top top", end: "bottom top", scrub: true },
        });
      }

      // "Falling blocks" entrance: the 3 cards drop/settle into their fanned position once
      // on load, then drift with an independent gentle float — the "sweet", not-overwhelming
      // motion cue.
      const cards = [
        { el: leftCardRef.current, rotate: -10, floatDelay: 0 },
        { el: centerCardRef.current, rotate: 0, floatDelay: 0.25 },
        { el: rightCardRef.current, rotate: 9, floatDelay: 0.5 },
      ];
      cards.forEach(({ el, rotate, floatDelay }, i) => {
        if (!el) return;
        gsap.fromTo(
          el,
          { y: -40, opacity: 0, rotate: rotate * 2.2, scale: 0.92 },
          { y: 0, opacity: 1, rotate, scale: 1, duration: 0.9, delay: 0.15 + i * 0.12, ease: "power3.out" },
        );
        gsap.to(el, { y: -12, duration: 2.4, ease: "sine.inOut", yoyo: true, repeat: -1, delay: 1 + floatDelay });
      });
    },
    { scope: sectionRef, dependencies: [reducedMotion] },
  );

  return (
    <section
      ref={sectionRef}
      style={{ minHeight: `calc(100vh - ${NAV_HEIGHT + HERO_TRIM}px)` }}
      className="relative isolate flex flex-col overflow-hidden rounded-b-[56px]"
    >
      {/* Full-bleed color panel — deliberately theme-independent (always-on gradient),
          same technique as the dark SDK section further down the page. */}
      <div
        ref={bgRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 rounded-b-[56px] bg-gradient-to-br from-[#1e1b4b] via-brand-700 to-[#6d7fd8]"
      >
        <div className="absolute -left-24 top-1/3 h-72 w-72 rounded-full bg-fuchsia-500/25 blur-3xl" />
        <div className="absolute right-10 top-10 h-64 w-64 rounded-full bg-cyan-400/20 blur-3xl" />
      </div>

      <div className="mx-auto flex w-full max-w-[1300px] flex-1 items-center px-6 py-16 md:px-10">
        <div className="grid w-full grid-cols-1 items-center gap-12 md:grid-cols-[1.2fr_1fr] md:gap-10">
          <div className="text-left">
            <Reveal as="h1" className="mb-7 max-w-[640px] text-[clamp(2.1rem,4.4vw,3.75rem)] font-extrabold leading-[1.08] tracking-[-0.03em] text-white">
              <span className="whitespace-nowrap">Build and publish.</span>
              <br />
              Exactly how you{" "}
              <span className="bg-gradient-to-r from-white via-fuchsia-200 to-cyan-200 bg-clip-text text-transparent">
                imagine it.
              </span>
            </Reveal>

            <Reveal as="p" delay={0.1} className="mb-10 max-w-[520px] text-[1.2rem] leading-relaxed text-white/75">
              An intuitive drag-and-drop web and email builder equipped with an SDK, an MCP server, and AI publish
              capabilities. Create multi-page experiences with custom domains, seamlessly.
            </Reveal>

            <Reveal delay={0.2}>
              <Link
                href="/auth/register?plan=FREE"
                className="inline-flex items-center gap-2 rounded-xl bg-white px-9 py-4.5 text-[1.02rem] font-bold text-brand-700 transition-transform hover:-translate-y-0.5"
              >
                Start Building — It&apos;s free
                <ArrowRight size={18} />
              </Link>
            </Reveal>
          </div>

          {/* Fanned stack: 3 tilted mock panels, left/center/right, layered like falling cards. */}
          <div className="relative mx-auto h-[380px] w-full max-w-[500px] sm:h-[440px] md:mx-0 md:h-[480px] md:max-w-[500px]">
            <div
              ref={leftCardRef}
              className="absolute left-[-6%] top-[2%] z-10 w-[58%] rotate-[-12deg] overflow-hidden rounded-2xl border border-white/15 bg-[#0d0f1a] shadow-2xl"
            >
              <div className="flex items-center gap-1.5 border-b border-white/10 px-3 py-2.5">
                <LayoutTemplate size={12} className="text-cyan-300" />
                <span className="font-mono text-[0.62rem] text-white/40">web page</span>
              </div>
              <div className="p-4">
                <div className="mb-2.5 h-3 w-3/4 rounded bg-cyan-400/25" />
                <div className="mb-2 h-2 w-full rounded bg-white/10" />
                <div className="h-2 w-4/5 rounded bg-white/10" />
              </div>
            </div>

            <div
              ref={rightCardRef}
              className="absolute right-[-6%] top-[-2%] z-10 w-[58%] rotate-[11deg] overflow-hidden rounded-2xl border border-white/15 bg-[#0d0f1a] shadow-2xl"
            >
              <div className="flex items-center gap-1.5 border-b border-white/10 px-3 py-2.5">
                <Mail size={12} className="text-fuchsia-300" />
                <span className="font-mono text-[0.62rem] text-white/40">email</span>
              </div>
              <div className="p-4">
                <div className="mb-2.5 h-3 w-2/3 rounded bg-fuchsia-400/25" />
                <div className="mb-2 h-2 w-full rounded bg-white/10" />
                <div className="h-2 w-3/4 rounded bg-white/10" />
              </div>
            </div>

            <div
              ref={centerCardRef}
              className="absolute inset-0 z-20 m-auto h-[280px] w-[88%] max-w-[420px] overflow-hidden rounded-2xl border border-white/15 bg-[#0d0f1a] shadow-2xl sm:h-[320px]"
            >
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <div className="flex items-center gap-1.5">
                  {["#f87171", "#fbbf24", "#34d399"].map((c) => (
                    <span key={c} className="h-2.5 w-2.5 rounded-full opacity-70" style={{ background: c }} />
                  ))}
                </div>
                <span className="font-mono text-[0.7rem] text-white/40">plexo.studio/canvas</span>
                <span className="w-10" />
              </div>
              <div className="p-6">
                <div className="mb-3 h-4 w-2/3 rounded bg-brand-400/30" />
                <div className="mb-5 h-2.5 w-4/5 rounded bg-white/10" />
                <div className="mb-2 h-9 w-36 rounded-lg bg-gradient-to-br from-brand-400 to-fuchsia-500" />
                <div className="mt-4 flex items-center gap-1.5 text-white/40">
                  <MousePointerClick size={13} />
                  <Wand2 size={13} />
                  <span className="text-[0.68rem] font-mono">live · published in 1 click</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
