"use client";

import Link from "next/link";
import { useRef } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { Reveal, gsap, useGSAP, useReducedMotion } from "@/app/scroll-fx";

export function V2Hero({ isDark }: { isDark: boolean }) {
  const mockupRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useGSAP(
    () => {
      if (reducedMotion || !mockupRef.current) return;
      gsap.to(mockupRef.current, {
        y: -14,
        duration: 2.6,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
      });
    },
    { scope: mockupRef, dependencies: [reducedMotion] },
  );

  return (
    <section className={`relative transition-colors duration-500 rounded-b-[44px] md:rounded-b-[64px] overflow-hidden min-h-[calc(100vh-300px)] flex items-center pt-10 pb-16 px-4 sm:px-8 md:px-16 shadow-2xl font-['Mulish',sans-serif] ${
      isDark
        ? "bg-gradient-to-br from-[#120e24] via-[#1e163d] to-[#312257] text-white"
        : "bg-gradient-to-br from-[#4c24d6] via-[#6839ec] to-[#7f4ef8] text-white"
    }`}>
      <div className="max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
        {/* Left Column Text & CTAs */}
        <div className="lg:col-span-7 flex flex-col items-start text-left z-10 space-y-6">
          <Reveal>
            <h1 className="text-4xl sm:text-5xl lg:text-[64px] font-extrabold tracking-tight leading-[1.05] text-white">
              Build and publish. <br />
              Exactly how <br className="hidden sm:inline" />
              you imagine it.
            </h1>
          </Reveal>

          <Reveal delay={0.1}>
            <p className="text-base sm:text-lg md:text-xl font-medium text-white/90 max-w-xl leading-relaxed">
              An intuitive drag-and-drop web and email builder equipped with an SDK, an MCP server, and AI publish capabilities. Create multi-page experiences with custom domains, seamlessly.
            </p>
          </Reveal>

          <Reveal delay={0.2}>
            <div className="pt-2">
              <Link
                href="/auth/register"
                className="bg-white hover:bg-slate-100 text-[#4c24d6] text-base sm:text-lg font-extrabold px-8 py-4 rounded-2xl shadow-xl hover:shadow-2xl transition-all transform hover:-translate-y-0.5 active:translate-y-0 inline-flex items-center gap-3"
              >
                <span>Start Building — It&apos;s free</span>
                <ArrowRight className="w-5 h-5" />
              </Link>
            </div>
          </Reveal>
        </div>

        {/* Right Column Canvas & Floating Mockup Composition */}
        <div className="lg:col-span-5 relative flex justify-center lg:justify-end w-full overflow-hidden sm:overflow-visible">
          <div ref={mockupRef} className="relative w-full max-w-[480px] space-y-3">
            {/* Background Decorative Glow */}
            <div className="absolute -top-6 right-0 sm:-top-12 sm:-right-12 w-64 h-64 bg-purple-500/25 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-6 left-0 sm:-bottom-12 sm:-left-12 w-64 h-64 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none" />

            {/* Overlapping Mockup Card 1 (Email Template) */}
            <div className="w-[85%] ml-auto bg-slate-900/95 text-white rounded-2xl p-4 border border-white/20 shadow-2xl backdrop-blur-md space-y-2 transform -rotate-3 hover:rotate-0 transition-transform duration-300">
              <div className="flex items-center justify-between text-[11px] font-mono text-purple-300">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-purple-400" />
                  ✉️ email-template.mjml
                </span>
                <span className="text-white/60">MJML 4.0</span>
              </div>
              <div className="h-2 w-3/4 bg-purple-500/40 rounded-full" />
              <div className="h-2 w-1/2 bg-white/20 rounded-full" />
            </div>

            {/* Overlapping Mockup Card 2 (Web Page) */}
            <div className="w-[90%] bg-slate-900/95 text-white rounded-2xl p-4 border border-white/20 shadow-2xl backdrop-blur-md space-y-2 transform rotate-2 hover:rotate-0 transition-transform duration-300">
              <div className="flex items-center justify-between text-[11px] font-mono text-cyan-300">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-cyan-400" />
                  🌐 landing-page.tsx
                </span>
                <span className="text-emerald-400 font-bold">100% Responsive</span>
              </div>
              <div className="h-2 w-4/5 bg-cyan-500/40 rounded-full" />
              <div className="h-2 w-2/3 bg-white/20 rounded-full" />
            </div>

            {/* Main Interactive Studio Canvas Window */}
            <div className="bg-[#0b0f19] text-white rounded-3xl p-5 border border-white/20 shadow-2xl space-y-4 relative z-20">
              {/* Window Header Dots */}
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-red-500" />
                  <span className="w-3 h-3 rounded-full bg-yellow-500" />
                  <span className="w-3 h-3 rounded-full bg-green-500" />
                </div>
                <span className="font-mono text-xs text-slate-400">plexo.studio/canvas</span>
              </div>

              {/* Canvas Content */}
              <div className="space-y-3 py-2">
                <div className="h-4 w-3/5 bg-purple-500/30 rounded-lg" />
                <div className="h-3 w-4/5 bg-slate-800 rounded-lg" />

                {/* Primary Button Block */}
                <div className="h-10 w-full bg-gradient-to-r from-purple-500 to-indigo-500 rounded-xl flex items-center justify-center font-bold text-xs shadow-lg">
                  Generate Component with AI
                </div>

                {/* Live Status Badge */}
                <div className="flex items-center justify-between pt-2 text-[11px] font-mono text-slate-400 border-t border-white/10">
                  <div className="flex items-center gap-1.5 text-emerald-400 font-bold">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>live - published in 1 click</span>
                  </div>
                  <span className="bg-purple-900/60 text-purple-300 px-2 py-0.5 rounded-md font-sans text-[10px]">
                    MCP Ready
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
