"use client";

import { useRef } from "react";
import { Triangle, Atom, Hexagon, Sparkles, MessageSquare, Bot, User, Wand2 } from "lucide-react";
import { Reveal, OpenReveal, gsap, useGSAP, useReducedMotion } from "../scroll-fx";
import { Kicker, MockFrame } from "./ui";

const INTEGRATIONS = [
  { label: "Next.js", icon: Triangle },
  { label: "React", icon: Atom },
  { label: "Node.js", icon: Hexagon },
  { label: "Claude", icon: Sparkles },
  { label: "ChatGPT", icon: MessageSquare },
];

export function IntegrationsSection() {
  const skeletonRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useGSAP(
    () => {
      if (reducedMotion || !skeletonRef.current) return;
      const bars = gsap.utils.toArray<HTMLElement>(".gen-bar", skeletonRef.current);
      gsap.to(bars, { opacity: 0.35, duration: 0.9, ease: "sine.inOut", yoyo: true, repeat: -1, stagger: 0.15 });
    },
    { scope: skeletonRef, dependencies: [reducedMotion] },
  );

  return (
    <section id="products" className="landing-section">
      <div className="landing-container">
        <Reveal className="mb-16 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
          <span className="text-xs font-bold tracking-[0.14em] text-[var(--text-faint)] uppercase">Integrates seamlessly with</span>
          {INTEGRATIONS.map(({ label, icon: Icon }) => (
            <span key={label} className="flex items-center gap-2 text-sm font-semibold text-[var(--text-muted)]">
              <Icon size={16} />
              {label}
            </span>
          ))}
        </Reveal>

        <Reveal className="mx-auto mb-12 max-w-[720px] text-center">
          <h2 className="font-heading text-[clamp(1.9rem,4vw,3rem)] font-extrabold tracking-[-0.025em] text-[var(--text-main)]">
            Limitless customization. Go live instantly.
          </h2>
        </Reveal>

        <OpenReveal>
          <div className="mb-20 grid grid-cols-1 gap-6 rounded-[32px] border border-[var(--surface-border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-card)] md:grid-cols-2 md:p-10">
            <div>
              <Kicker>AI Publish</Kicker>
              <h3 className="mb-3 text-2xl font-bold text-[var(--text-main)]">
                Design &amp; publish directly from Claude.ai &amp; ChatGPT
              </h3>
              <p className="mb-6 text-[0.92rem] leading-relaxed text-[var(--text-muted)]">
                The Plexo MCP server hands your assistant 17 purpose-built tools — it can draft a page, tweak a
                section, and push it live to a custom domain, all from a single conversation.
              </p>
              <MockFrame title="MCP Session">
                <div className="flex flex-col gap-3 p-4">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--surface-border)]">
                      <User size={12} className="text-[var(--text-muted)]" />
                    </span>
                    <p className="rounded-xl bg-[var(--bg-1)] px-3 py-2 text-[0.8rem] text-[var(--text-main)]">
                      Add a pricing section with three tiers, then publish to my domain.
                    </p>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700">
                      <Bot size={12} className="text-white" />
                    </span>
                    <p className="rounded-xl bg-[var(--brand-subtle)] px-3 py-2 text-[0.8rem] text-[var(--text-main)]">
                      Done — pricing section added and your page is live at yourdomain.com. ✓
                    </p>
                  </div>
                </div>
              </MockFrame>
            </div>

            <div ref={skeletonRef} className="flex flex-col justify-center rounded-2xl border border-[var(--surface-border)] bg-[var(--bg-1)] p-6">
              <div className="mb-4 flex items-center gap-2 text-[var(--text-faint)]">
                <Wand2 size={13} />
                <span className="font-mono text-[0.7rem]">generating live preview…</span>
              </div>
              <div className="gen-bar mb-3 h-5 w-3/4 rounded bg-[var(--brand-subtle)]" />
              <div className="gen-bar mb-2 h-2.5 w-full rounded bg-[var(--surface-border)]" />
              <div className="gen-bar mb-6 h-2.5 w-5/6 rounded bg-[var(--surface-border)]" />
              <div className="grid grid-cols-3 gap-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="gen-bar h-16 rounded-xl bg-[var(--surface)]" />
                ))}
              </div>
            </div>
          </div>
        </OpenReveal>
      </div>
    </section>
  );
}
