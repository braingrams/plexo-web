"use client";

import Link from "next/link";
import { ArrowRight, Cpu } from "lucide-react";
import { Reveal } from "@/app/scroll-fx";

export function V2DarkFeatureSection({ isDark }: { isDark: boolean }) {
  return (
    <section className={`py-20 md:py-28 px-4 sm:px-8 md:px-16 transition-colors duration-500 font-['Mulish',sans-serif] ${
      isDark ? "bg-[#0b0f19] text-white" : "bg-white text-slate-950"
    }`}>
      <div className="max-w-7xl mx-auto">
        {/* Main Dark Navy Card Container */}
        <div className="bg-[#090d16] text-white rounded-[40px] md:rounded-[56px] p-8 sm:p-12 md:p-16 relative overflow-hidden shadow-2xl border border-slate-800/80">
          {/* Top Row: Left Text + Right Code Window */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center mb-16">
            <div className="lg:col-span-6 space-y-6">
              <Reveal>
                <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-extrabold bg-purple-500/10 text-purple-400 border border-purple-500/20">
                  <Cpu className="w-3.5 h-3.5" />
                  <span>DEVELOPER SDK &amp; API</span>
                </div>
              </Reveal>

              <Reveal delay={0.1}>
                <h2 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight leading-[1.08] text-white">
                  Powered by the <br />
                  Plexo SDK.
                </h2>
              </Reveal>

              <Reveal delay={0.2}>
                <p className="text-slate-400 text-base sm:text-lg font-medium max-w-lg leading-relaxed">
                  Take total control with <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-sm text-purple-300">@charisol/plexo-sdk</code> and MCP integrations, built for developer-first workflows.
                </p>
              </Reveal>

              <Reveal delay={0.3}>
                <Link
                  href="/developers#sdk"
                  className="bg-[#6b3bf9] hover:bg-[#5b2be6] text-white text-base font-bold px-7 py-3.5 rounded-xl shadow-lg hover:shadow-xl transition-all inline-flex items-center gap-2"
                >
                  <span>Explore SDK Docs</span>
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </Reveal>
            </div>

            {/* Right Side Code Window */}
            <div className="lg:col-span-6 relative">
              <Reveal delay={0.15}>
                <div className="overflow-hidden rounded-2xl border border-white/15 bg-[#0d0f1a] shadow-2xl">
                  <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {["#f87171", "#fbbf24", "#34d399"].map((c) => (
                        <span key={c} className="h-2.5 w-2.5 rounded-full opacity-70" style={{ background: c }} />
                      ))}
                    </div>
                    <span className="font-mono text-[0.75rem] text-slate-400">app/page-builder.tsx</span>
                    <span className="w-10" />
                  </div>
                  <pre className="overflow-x-auto p-5 font-mono text-[0.78rem] leading-relaxed text-slate-300">
                    <code>{`import { PlexoBuilder } from "@charisol/plexo-sdk";

export default function MySaaSPage() {
  return (
    <PlexoBuilder
      mode="landing_page"
      apiKey={process.env.NEXT_PUBLIC_PLEXO_API_KEY}
      useAi
      onSave={({ json, html }) => console.log("Saved:", html)}
    />
  );
}`}</code>
                  </pre>
                </div>
              </Reveal>
            </div>
          </div>

          {/* Bottom Row: 3 Feature Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-8 border-t border-slate-800/80 items-stretch">
            <Reveal delay={0.1}>
              <div className="bg-[#121722] rounded-3xl p-6 sm:p-8 border border-slate-800/80 relative overflow-hidden flex flex-col justify-between h-full min-h-[220px]">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold text-slate-500">01 —</span>
                  <span className="text-3xl font-extrabold text-slate-800/50 font-mono select-none">zero</span>
                </div>
                <h3 className="text-xl sm:text-2xl font-extrabold text-white leading-snug mt-6">
                  Free tier with full visual drag-and-drop builder
                </h3>
              </div>
            </Reveal>

            <Reveal delay={0.2}>
              <div className="bg-[#121722] rounded-3xl p-6 sm:p-8 border border-slate-800/80 relative overflow-hidden flex flex-col justify-between h-full min-h-[220px]">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold text-slate-500">02 —</span>
                  <div className="flex items-center gap-1.5 text-xs font-mono font-bold">
                    <span className="text-purple-400">&lt;html&gt;</span>
                    <span className="text-cyan-400">&lt;css&gt;</span>
                    <span className="text-emerald-400">&lt;mjml&gt;</span>
                  </div>
                </div>
                <h3 className="text-xl sm:text-2xl font-extrabold text-white leading-snug mt-6">
                  Production-ready HTML5 &amp; MJML code export
                </h3>
              </div>
            </Reveal>

            <Reveal delay={0.3}>
              <div className="bg-[#121722] rounded-3xl p-6 sm:p-8 border border-slate-800/80 relative overflow-hidden flex flex-col justify-between h-full min-h-[220px]">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold text-slate-500">03 —</span>
                  <span className="text-[11px] font-mono font-bold text-purple-300 bg-purple-950/80 border border-purple-800/60 px-2.5 py-1 rounded-full">
                    MCP Connected
                  </span>
                </div>
                <h3 className="text-xl sm:text-2xl font-extrabold text-white leading-snug mt-6">
                  Instant MCP &amp; AI agent synchronization
                </h3>
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
