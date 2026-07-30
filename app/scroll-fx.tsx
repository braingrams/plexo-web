"use client";

import { CSSProperties, ElementType, ReactNode, useEffect, useRef, useState } from "react";
import { ReactLenis, useLenis } from "lenis/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

let gsapRegistered = false;
function ensureGsapRegistered() {
  if (!gsapRegistered && typeof window !== "undefined") {
    gsap.registerPlugin(ScrollTrigger);
    gsapRegistered = true;
  }
}
ensureGsapRegistered();

export { gsap, ScrollTrigger, useGSAP };

/** SSR-safe: starts false (matches server render), corrects itself right after mount. A
 * few-ms window where reduced-motion users briefly see the enhanced version is an
 * acceptable trade-off for not fighting hydration. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}

/** Bridges Lenis's smooth-scroll ticks into GSAP's ScrollTrigger so scroll-linked
 * animations track the eased scroll position rather than the raw (jumpier) native one —
 * the standard GSAP-recommended Lenis integration. Must render inside <ReactLenis>. */
function LenisScrollTriggerBridge() {
  const lenis = useLenis();

  useEffect(() => {
    if (!lenis) return;
    const onTick = (time: number) => lenis.raf(time * 1000);
    const onScroll = () => ScrollTrigger.update();
    gsap.ticker.add(onTick);
    gsap.ticker.lagSmoothing(0);
    lenis.on("scroll", onScroll);
    return () => {
      gsap.ticker.remove(onTick);
      lenis.off("scroll", onScroll);
    };
  }, [lenis]);

  return null;
}

/** Wraps the homepage in smooth inertial scroll + keeps ScrollTrigger in sync with it.
 * Skips Lenis entirely under prefers-reduced-motion, falling back to native scroll —
 * only mounted within the homepage's own tree (not the root layout), so it never
 * touches /dashboard's scroll/drag-and-drop behavior. */
export function ScrollFxProvider({ children }: { children: ReactNode }) {
  const reducedMotion = useReducedMotion();

  if (reducedMotion) {
    return <>{children}</>;
  }

  return (
    <ReactLenis root options={{ autoRaf: false, lerp: 0.1, duration: 1.2, smoothWheel: true }}>
      <LenisScrollTriggerBridge />
      {children}
    </ReactLenis>
  );
}

type RevealProps = {
  children: ReactNode;
  as?: ElementType;
  delay?: number;
  y?: number;
  className?: string;
  style?: CSSProperties;
};

/** Generic "scroll to reveal" wrapper — fades/slides an element in once as it enters the
 * viewport. Falls back to a plain render (no animation) under reduced motion. Used for
 * every section that just needs a simple entrance rather than bespoke choreography. */
export function Reveal({ children, as: Tag = "div", delay = 0, y = 28, className, style }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useGSAP(
    () => {
      if (reducedMotion || !ref.current) return;
      gsap.fromTo(
        ref.current,
        { opacity: 0, y },
        {
          opacity: 1,
          y: 0,
          duration: 0.9,
          delay,
          ease: "power3.out",
          scrollTrigger: {
            trigger: ref.current,
            start: "top 85%",
            toggleActions: "play none none none",
          },
        },
      );
    },
    { scope: ref, dependencies: [reducedMotion] },
  );

  return (
    <Tag ref={ref} className={className} style={{ ...style, opacity: reducedMotion ? 1 : undefined }}>
      {children}
    </Tag>
  );
}

/** "Scroll in to open" — a clip-path + scale panel reveal, distinct from Reveal's plain
 * fade/slide. Used for the code playground and FAQ panels, which should feel like they're
 * opening rather than just fading in. */
export function OpenReveal({ children, as: Tag = "div", delay = 0, className, style }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useGSAP(
    () => {
      if (reducedMotion || !ref.current) return;
      gsap.fromTo(
        ref.current,
        { opacity: 0, scale: 0.94, clipPath: "inset(8% round 24px)" },
        {
          opacity: 1,
          scale: 1,
          clipPath: "inset(0% round 24px)",
          duration: 1,
          delay,
          ease: "power3.out",
          scrollTrigger: {
            trigger: ref.current,
            start: "top 82%",
            toggleActions: "play none none none",
          },
        },
      );
    },
    { scope: ref, dependencies: [reducedMotion] },
  );

  return (
    <Tag ref={ref} className={className} style={{ ...style, opacity: reducedMotion ? 1 : undefined }}>
      {children}
    </Tag>
  );
}
