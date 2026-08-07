"use client";

import { useState } from "react";
import { Sparkles, Palette, Layers, ArrowRight, Check } from "lucide-react";
import { Reveal } from "@/app/scroll-fx";

export function V2StrataSection({ isDark }: { isDark: boolean }) {
  const [projectId, setProjectId] = useState("strata_proj_88491a");

  return (
    <section id="strata" className={`py-20 md:py-28 px-4 sm:px-8 md:px-16 transition-colors duration-500 font-['Mulish',sans-serif] ${
      isDark ? "bg-[#080b12] text-white" : "bg-slate-50 text-slate-950"
    }`}>
      <div className="max-w-7xl mx-auto space-y-16">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto space-y-4">
          <Reveal>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-extrabold bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <Palette className="w-3.5 h-3.5 text-purple-400" />
              <span>STRATA DESIGN SYSTEM INTEGRATION</span>
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight leading-[1.1]">
              Bring your Strata Design Tokens into Plexo with one Project ID
            </h2>
          </Reveal>

          <Reveal delay={0.2}>
            <p className={`text-base sm:text-lg font-medium leading-relaxed max-w-2xl mx-auto ${
              isDark ? "text-slate-400" : "text-slate-600"
            }`}>
              Sync your team&apos;s brand colors, typography tokens, border radii, and UI guidelines directly into the Plexo Visual Builder and MCP AI Agents.
            </p>
          </Reveal>
        </div>

        {/* 3-Step Process Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Reveal delay={0.1}>
            <div className={`p-8 rounded-3xl border shadow-xl space-y-4 h-full flex flex-col justify-between transition-colors ${
              isDark ? "bg-[#101524] border-slate-800 text-white" : "bg-white border-slate-200 text-slate-950"
            }`}>
              <div className="space-y-4">
                <span className="text-xs font-mono font-bold text-purple-400 bg-purple-500/10 border border-purple-500/20 px-3 py-1 rounded-full inline-block">
                  STEP 01
                </span>
                <h3 className="text-xl font-extrabold">Paste Strata Project ID</h3>
                <p className={`text-xs font-medium leading-relaxed ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                  Enter your Strata Project ID (<code className="font-mono text-purple-400">strata_proj_88491a</code>) in Workspace Settings or supply it once to your MCP agent.
                </p>
              </div>

              <div className="bg-slate-950 text-white p-4 rounded-2xl border border-slate-800 font-mono text-xs flex items-center justify-between">
                <span className="text-slate-400">Project ID:</span>
                <span className="text-purple-300 font-bold">{projectId}</span>
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.2}>
            <div className={`p-8 rounded-3xl border shadow-xl space-y-4 h-full flex flex-col justify-between transition-colors ${
              isDark ? "bg-[#101524] border-slate-800 text-white" : "bg-white border-slate-200 text-slate-950"
            }`}>
              <div className="space-y-4">
                <span className="text-xs font-mono font-bold text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-3 py-1 rounded-full inline-block">
                  STEP 02
                </span>
                <h3 className="text-xl font-extrabold">Auto-Fetch Brand Tokens</h3>
                <p className={`text-xs font-medium leading-relaxed ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                  Plexo automatically parses your HSL color tokens, typography scales, font families, and button variants from Strata in real-time.
                </p>
              </div>

              <div className="bg-slate-950 text-white p-4 rounded-2xl border border-slate-800 font-mono text-xs flex items-center gap-3">
                <span className="w-3 h-3 rounded-full bg-purple-500" />
                <span className="w-3 h-3 rounded-full bg-indigo-500" />
                <span className="w-3 h-3 rounded-full bg-cyan-400" />
                <span className="text-slate-400 ml-auto">Tokens Synced</span>
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.3}>
            <div className={`p-8 rounded-3xl border shadow-xl space-y-4 h-full flex flex-col justify-between transition-colors ${
              isDark ? "bg-[#101524] border-slate-800 text-white" : "bg-white border-slate-200 text-slate-950"
            }`}>
              <div className="space-y-4">
                <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 rounded-full inline-block">
                  STEP 03
                </span>
                <h3 className="text-xl font-extrabold">Instant Builder Alignment</h3>
                <p className={`text-xs font-medium leading-relaxed ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                  The Visual Builder canvas and MCP AI prompt generators automatically construct pages strictly adhering to your Strata design system.
                </p>
              </div>

              <div className="bg-slate-950 text-emerald-400 p-4 rounded-2xl border border-slate-800 font-mono text-xs font-bold flex items-center justify-between">
                <span className="flex items-center gap-1"><Check className="w-3.5 h-3.5" /> 100% Brand Consistent</span>
                <Sparkles className="w-4 h-4" />
              </div>
            </div>
          </Reveal>
        </div>

        {/* Interactive Before/After Token Transformation Box */}
        <Reveal delay={0.25}>
          <div className="bg-[#090d16] text-white rounded-[40px] border border-slate-800/90 p-8 sm:p-12 shadow-2xl overflow-hidden relative">
            <div className="absolute top-0 right-0 w-96 h-96 bg-purple-600/15 rounded-full blur-3xl pointer-events-none" />

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center relative z-10">
              {/* Left Code Side */}
              <div className="lg:col-span-6 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3 text-xs font-mono text-slate-400">
                  <span className="flex items-center gap-2 text-purple-400 font-bold">
                    <Layers className="w-4 h-4" />
                    <span>strata-tokens.json</span>
                  </span>
                  <span className="text-emerald-400 font-bold">CONNECTED</span>
                </div>

                <pre className="p-5 bg-slate-950 rounded-2xl border border-slate-800 font-mono text-xs text-slate-300 overflow-x-auto leading-relaxed">
                  <code>{`{
  "strataProjectId": "strata_proj_88491a",
  "brandTokens": {
    "primaryColor": "hsl(255, 93%, 60%)",
    "fontHeading": "Mulish, sans-serif",
    "cardBorderRadius": "28px",
    "buttonShadow": "0 10px 25px rgba(107, 59, 249, 0.4)"
  }
}`}</code>
                </pre>
              </div>

              {/* Right Live Rendered UI Component */}
              <div className="lg:col-span-6 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3 text-xs font-mono text-slate-400">
                  <span className="text-cyan-400 font-bold">Live Rendered Plexo UI Component</span>
                  <span className="text-xs bg-purple-900/80 text-purple-200 px-2.5 py-0.5 rounded-full font-bold">
                    Strata Auto-Styled
                  </span>
                </div>

                <div className="bg-[#121726] border border-purple-500/40 rounded-[28px] p-6 shadow-[0_10px_25px_rgba(107,59,249,0.3)] text-white space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl bg-purple-600 flex items-center justify-center font-bold text-sm">
                        S
                      </div>
                      <div>
                        <h4 className="font-extrabold text-sm">Strata SaaS Component</h4>
                        <p className="text-[10px] text-purple-300">Auto-generated via MCP Agent</p>
                      </div>
                    </div>

                    <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-950/80 border border-emerald-800 px-2.5 py-1 rounded-full inline-flex items-center gap-1">
                      <Check className="w-2.5 h-2.5" /> Synced
                    </span>
                  </div>

                  <p className="text-xs font-medium text-slate-300 leading-relaxed">
                    This component was generated using your exact Strata color variables and typography hierarchy without manual CSS overrides.
                  </p>

                  <button className="w-full bg-[#6b3bf9] hover:bg-[#5b2be6] text-white font-extrabold text-xs py-3.5 rounded-xl shadow-lg shadow-purple-600/30 flex items-center justify-center gap-2 transition-all">
                    <span>Explore Component Library</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
