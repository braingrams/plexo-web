"use client";

import Link from "next/link";
import { useRef } from "react";
import { ArrowRight, Gauge, SlidersHorizontal, DollarSign } from "lucide-react";
import { Reveal, gsap, useGSAP, useReducedMotion } from "../scroll-fx";
import { Kicker } from "./ui";

const RELIABILITY_CARDS = [
  { n: "01", icon: Gauge, title: "100% uptime & support", desc: "Unmatched reliability, backed by a team that actually answers.", color: "text-brand-400" },
  { n: "02", icon: SlidersHorizontal, title: "Highly customizable", desc: "Tweak every pixel, token, and block — nothing is locked down.", color: "text-fuchsia-400" },
  { n: "03", icon: DollarSign, title: "Incredible value for money", desc: "Enterprise-grade features at startup-friendly pricing.", color: "text-cyan-400" },
];

export function DarkSdkSection() {
  const panelRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useGSAP(
    () => {
      if (reducedMotion || !panelRef.current) return;
      gsap.to(panelRef.current, { y: -10, duration: 2.2, ease: "sine.inOut", yoyo: true, repeat: -1 });
    },
    { scope: panelRef, dependencies: [reducedMotion] },
  );

  return (
    <section id="sdk" className="relative -mt-10 rounded-t-[56px] rounded-b-[56px] bg-surface-0 px-6 pb-24 pt-20 text-white">
      <div className="mx-auto max-w-[1200px]">
        <div className="mb-20 grid grid-cols-1 items-center gap-12 md:grid-cols-2">
          <Reveal>
            <Kicker tone="light">Developer First</Kicker>
            <h2 className="font-heading mb-5 text-[clamp(1.9rem,4vw,3rem)] font-extrabold tracking-[-0.03em]">
              Powered by the Plexo SDK.
            </h2>
            <p className="mb-7 max-w-[440px] text-[0.98rem] leading-relaxed text-white/60">
              Take total control with <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[0.85em]">@charisol/plexo-sdk</code>{" "}
              and MCP integrations, built for developer-first workflows.
            </p>
            <Link href="/sdk" className="inline-flex items-center gap-1.5 text-[0.9rem] font-semibold text-brand-400 hover:text-brand-300">
              View SDK docs <ArrowRight size={15} />
            </Link>
          </Reveal>

          <Reveal delay={0.1}>
            <div ref={panelRef} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <div className="flex items-center gap-1.5">
                  {["#f87171", "#fbbf24", "#34d399"].map((c) => (
                    <span key={c} className="h-2.5 w-2.5 rounded-full opacity-70" style={{ background: c }} />
                  ))}
                </div>
                <span className="font-mono text-[0.7rem] text-white/40">editor.tsx</span>
                <span className="w-10" />
              </div>
              <pre className="overflow-x-auto p-5 font-mono text-[0.78rem] leading-relaxed text-white/80">
                <code>{`import { PlexoBuilder } from "@charisol/plexo-sdk";

<PlexoBuilder
  mode="landing_page"
  apiKey={process.env.PLEXO_API_KEY}
  useAi
/>`}</code>
              </pre>
            </div>
          </Reveal>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          {RELIABILITY_CARDS.map(({ n, icon: Icon, title, desc, color }, i) => (
            <Reveal key={n} delay={i * 0.1} className="rounded-3xl border border-white/10 bg-white/[0.03] p-7">
              <div className="mb-6 flex items-center justify-between">
                <span className="font-mono text-xs text-white/35">{n}</span>
                <Icon size={18} className={color} />
              </div>
              <h3 className="mb-2 text-[1.05rem] font-bold">{title}</h3>
              <p className="text-[0.85rem] leading-relaxed text-white/55">{desc}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
