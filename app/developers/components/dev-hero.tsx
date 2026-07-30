"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowRight, Code, Terminal, Sparkles, Cpu, Copy, Check, Zap, Layers } from "lucide-react";
import { Reveal, gsap, useGSAP, useReducedMotion } from "@/app/scroll-fx";

export function DevHero({ isDark }: { isDark: boolean }) {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  const handleCopy = () => {
    navigator.clipboard.writeText("npm i @charisol/plexo-sdk");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useGSAP(
    () => {
      if (reducedMotion || !codeRef.current) return;
      gsap.to(codeRef.current, {
        y: -12,
        duration: 2.6,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
      });
    },
    { scope: codeRef, dependencies: [reducedMotion] },
  );

  return (
    <section className={`relative transition-colors duration-500 rounded-b-[44px] md:rounded-b-[64px] overflow-hidden min-h-[calc(100vh-280px)] flex items-center pt-12 pb-20 px-4 sm:px-8 md:px-16 shadow-2xl font-['Mulish',sans-serif] ${
      isDark
        ? "bg-gradient-to-br from-[#0c081e] via-[#161033] to-[#25184a] text-white"
        : "bg-gradient-to-br from-[#431fc4] via-[#5c2de3] to-[#7644f5] text-white"
    }`}>
      {/* Background Radial Glow & Ambient Orbs */}
      <div className="absolute top-1/4 -left-20 w-80 h-80 bg-purple-500/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-96 h-96 bg-cyan-500/15 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-12 items-center relative z-10">
        {/* Left Column Text & Quickstart Actions */}
        <div className="lg:col-span-7 flex flex-col items-start text-left space-y-6">
          <Reveal>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-extrabold bg-white/10 backdrop-blur-md border border-white/20 text-cyan-200 shadow-md">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
              <Cpu className="w-3.5 h-3.5 text-cyan-300" />
              <span>PLEXO DEVELOPER HUB &amp; API ENGINE</span>
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <h1 className="text-4xl sm:text-5xl lg:text-[64px] font-extrabold tracking-tight leading-[1.06] text-white">
              Embed, Automate &amp; <br />
              <span className="bg-gradient-to-r from-purple-200 via-cyan-200 to-white bg-clip-text text-transparent">
                Build with AI Agents.
              </span>
            </h1>
          </Reveal>

          <Reveal delay={0.2}>
            <p className="text-base sm:text-lg md:text-xl font-medium text-white/90 max-w-xl leading-relaxed">
              Integrate the Plexo visual builder into your SaaS with our SDK, or connect Cursor, Claude, and Antigravity via our native MCP server.
            </p>
          </Reveal>

          {/* Quickstart Command Pill & Action Buttons */}
          <Reveal delay={0.25}>
            <div className="flex flex-wrap items-center gap-4 pt-2">
              <div className="bg-slate-950/90 text-white border border-white/25 rounded-2xl px-5 py-3.5 flex items-center gap-3 font-mono text-xs sm:text-sm shadow-2xl backdrop-blur-md hover:border-purple-400/50 transition-colors group">
                <span className="text-purple-400 font-bold">$</span>
                <span className="text-slate-200">npm i @charisol/plexo-sdk</span>
                <button
                  onClick={handleCopy}
                  className="ml-2 text-slate-400 hover:text-white transition-colors p-1"
                  aria-label="Copy Command"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>

              <a
                href="#mcp"
                className="bg-white hover:bg-slate-100 text-[#431fc4] text-sm font-extrabold px-6 py-4 rounded-2xl shadow-xl transition-all transform hover:-translate-y-0.5 active:translate-y-0 inline-flex items-center gap-2"
              >
                <span>Configure MCP Server</span>
                <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          </Reveal>
        </div>

        {/* Right Code Window Visual */}
        <div className="lg:col-span-5 relative flex justify-center lg:justify-end">
          <div ref={codeRef} className="w-full max-w-[480px]">
            <div className="overflow-hidden rounded-3xl border border-white/20 bg-slate-950/95 shadow-2xl text-xs font-mono backdrop-blur-xl">
              {/* Terminal Window Header */}
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5 text-slate-400 bg-slate-900/60">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-red-500" />
                  <span className="w-3 h-3 rounded-full bg-yellow-500" />
                  <span className="w-3 h-3 rounded-full bg-green-500" />
                </div>
                <span className="font-bold text-slate-300">app/developer-quickstart.tsx</span>
                <span className="bg-purple-950 text-purple-300 border border-purple-800/60 px-2 py-0.5 rounded-md text-[10px]">
                  SDK v1.0.40
                </span>
              </div>

              {/* Code Snippet */}
              <pre className="p-6 overflow-x-auto leading-relaxed text-slate-300">
                <code>{`import { PlexoBuilder } from "@charisol/plexo-sdk";
import { mcpServer } from "@charisol/plexo-mcp";

// 1. Embed Visual Builder Canvas
<PlexoBuilder
  apiKey="plx_live_99214"
  mode="web_builder"
  customDomain="yourdomain.com"
  onPublish={(site) => alert(site.url)}
/>

// 2. Connect AI Agents via MCP
mcpServer.registerTools({
  createPage: true,
  syncCustomDomain: true,
});`}</code>
              </pre>

              {/* Footer Status Bar */}
              <div className="px-5 py-3 bg-slate-900/90 border-t border-white/10 flex items-center justify-between text-[11px] text-slate-400">
                <div className="flex items-center gap-2 text-emerald-400 font-bold">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>SDK &amp; MCP Active</span>
                </div>
                <span className="text-cyan-300 font-bold">Vercel Edge Ready</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
