"use client";

import Link from "next/link";
import { ArrowRight, Layers, CheckCircle, FileCode, Terminal } from "lucide-react";
import { Reveal } from "@/app/scroll-fx";

export function V2FeatureCards({ isDark }: { isDark: boolean }) {
  return (
    <section className={`py-20 md:py-28 px-4 sm:px-8 md:px-16 space-y-16 transition-colors duration-500 font-['Mulish',sans-serif] ${
      isDark ? "bg-[#0b0f19] text-white" : "bg-white text-slate-950"
    }`}>
      <div className="max-w-7xl mx-auto space-y-16">
        {/* CARD 1: Drag & Drop Builder (Soft Blue/Purple) */}
        <Reveal>
          <div className={`rounded-[36px] p-8 sm:p-12 md:p-16 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center overflow-hidden border shadow-xl transition-colors ${
            isDark
              ? "bg-[#121626] border-slate-800 text-white"
              : "bg-[#dce8ff] border-blue-100/80 text-slate-950"
          }`}>
            <div className="lg:col-span-6 space-y-6">
              <span className={`text-xs font-bold tracking-widest uppercase ${
                isDark ? "text-purple-400" : "text-blue-700"
              }`}>
                DRAG &amp; DROP BUILDER
              </span>

              <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight leading-[1.1]">
                Build multi-page sites &amp; responsive emails in minutes
              </h2>

              <p className={`text-base sm:text-lg font-medium leading-relaxed max-w-lg ${
                isDark ? "text-slate-300" : "text-slate-700"
              }`}>
                Design pixel-perfect landing pages and responsive email templates visually. Re-use components, customize styles, and publish with one click.
              </p>

              <Link
                href="/auth/register"
                className="inline-flex items-center gap-2 text-purple-500 hover:text-purple-400 font-bold text-base transition-colors group pt-2"
              >
                <span>Start building now</span>
                <div className="w-8 h-8 rounded-full border border-purple-500 flex items-center justify-center group-hover:bg-purple-600 group-hover:text-white transition-all">
                  <ArrowRight className="w-4 h-4" />
                </div>
              </Link>
            </div>

            {/* Builder Workspace UI Mockup */}
            <div className="lg:col-span-6 relative flex justify-center">
              <div className="w-full max-w-[440px] bg-slate-950 text-white rounded-3xl p-6 shadow-2xl border border-slate-800 space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-4">
                  <Layers className="w-5 h-5 text-purple-400" />
                  <span className="font-bold text-sm">Plexo Visual Canvas Engine</span>
                  <span className="ml-auto text-xs font-bold text-emerald-400 bg-emerald-950/80 border border-emerald-800 px-2.5 py-1 rounded-full">v2.0 Active</span>
                </div>

                <div className="space-y-3 text-xs font-semibold text-slate-300">
                  <div className="flex justify-between items-center bg-slate-900 p-3 rounded-xl border border-slate-800">
                    <span>Page Tree Hierarchy</span>
                    <span className="text-purple-300 font-mono font-bold">/index, /pricing, /about</span>
                  </div>
                  <div className="flex justify-between items-center bg-slate-900 p-3 rounded-xl border border-slate-800">
                    <span>Subdomain Target</span>
                    <span className="text-cyan-300 font-mono font-bold">mysite.plexopages.com</span>
                  </div>
                  <div className="flex justify-between items-center bg-slate-900 p-3 rounded-xl border border-slate-800">
                    <span>Custom Domain</span>
                    <span className="text-emerald-400 font-mono font-bold">yourdomain.com</span>
                  </div>
                  <div className="flex justify-between items-center bg-slate-900 p-3 rounded-xl border border-slate-800">
                    <span>Code Format Exports</span>
                    <span className="text-purple-400 font-mono font-bold">HTML5 / React / MJML</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Reveal>

        {/* GRID ROW 2: Left AI Prompt Card + Right Soft Lavender Card (AI & MCP) */}
        <Reveal delay={0.1}>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
            {/* Left AI Terminal UI Mockup Card */}
            <div className="lg:col-span-5 bg-gradient-to-br from-purple-950 via-slate-950 to-indigo-950 rounded-[36px] p-8 border border-purple-900/60 shadow-xl flex flex-col justify-between text-white min-h-[420px]">
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-purple-800/40 pb-3 text-xs font-mono text-purple-300">
                  <span className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-purple-400" />
                    <span>mcp-server-agent.ts</span>
                  </span>
                  <span className="text-emerald-400 font-bold">● CONNECTED</span>
                </div>

                <div className="space-y-2 font-mono text-xs text-slate-300 bg-slate-900/80 p-4 rounded-2xl border border-slate-800">
                  <p className="text-purple-400">&gt; @plexo generate --type landing-page</p>
                  <p className="text-slate-400">Analyzing brand tokens and components...</p>
                  <p className="text-emerald-400 font-bold">✔ Generated 4 sections in 0.8s</p>
                  <p className="text-cyan-300 font-bold">✔ Linked to yourdomain.com</p>
                </div>
              </div>

              <div className="space-y-2 pt-6 border-t border-purple-800/30">
                <span className="bg-purple-900/60 text-purple-200 border border-purple-700/50 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">
                  MCP PROMPT CANVAS
                </span>
                <h3 className="text-2xl font-extrabold">Autonomous AI page creation</h3>
              </div>
            </div>

            {/* Right Lavender Card (AI & MCP Agent Integration) */}
            <div className={`lg:col-span-7 rounded-[36px] p-8 sm:p-12 flex flex-col justify-between overflow-hidden relative border shadow-xl min-h-[420px] transition-colors ${
              isDark
                ? "bg-[#17132a] border-purple-900/40 text-white"
                : "bg-[#eadaff] border-purple-100 text-slate-950"
            }`}>
              <div className="space-y-6 max-w-md z-10">
                <span className="text-xs font-bold tracking-widest text-purple-400 uppercase">
                  AI &amp; MCP AGENT INTEGRATION
                </span>

                <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight leading-[1.1]">
                  Generate &amp; edit pages via AI agents &amp; MCP
                </h2>

                <p className={`text-base sm:text-lg font-medium leading-relaxed ${
                  isDark ? "text-slate-300" : "text-slate-700"
                }`}>
                  Connect Cursor, Antigravity, or Claude to your Plexo workspace via MCP. Prompt your AI assistant to generate, edit, or publish pages autonomously.
                </p>

                <Link
                  href="/developers#mcp"
                  className="inline-flex items-center gap-2 text-purple-400 hover:text-purple-300 font-bold text-base transition-colors group"
                >
                  <span>Connect MCP Server</span>
                  <div className="w-8 h-8 rounded-full border border-purple-400 flex items-center justify-center group-hover:bg-purple-600 group-hover:text-white transition-all">
                    <ArrowRight className="w-4 h-4" />
                  </div>
                </Link>
              </div>

              {/* 3D Floating Tool Spheres */}
              <div className="absolute -bottom-8 -right-8 w-72 h-72 rounded-full bg-gradient-to-br from-indigo-500/20 to-purple-600/30 blur-2xl pointer-events-none" />
              <div className="absolute bottom-6 right-6 flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-slate-900 shadow-xl flex items-center justify-center text-xs font-extrabold text-purple-300 border border-purple-700 animate-bounce">
                  AI ⚡
                </div>
                <div className="w-14 h-14 rounded-full bg-slate-900 shadow-xl flex items-center justify-center text-xs font-extrabold text-indigo-300 border border-indigo-700">
                  MCP 🔌
                </div>
                <div className="w-12 h-12 rounded-full bg-slate-900 shadow-xl flex items-center justify-center text-xs font-extrabold text-cyan-300 border border-cyan-700 animate-pulse">
                  SDK 🛠️
                </div>
              </div>
            </div>
          </div>
        </Reveal>

        {/* CARD 3: Custom Domains & Fast Hosting (Light Green/Teal) */}
        <Reveal delay={0.15}>
          <div className={`rounded-[36px] p-8 sm:p-12 md:p-16 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center overflow-hidden border shadow-xl transition-colors ${
            isDark
              ? "bg-[#101b1b] border-teal-900/60 text-white"
              : "bg-[#dcf5d8] border-emerald-100 text-slate-950"
          }`}>
            <div className="lg:col-span-6 space-y-6">
              <span className="text-xs font-bold tracking-widest text-emerald-400 uppercase">
                CUSTOM DOMAINS &amp; FAST HOSTING
              </span>

              <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight leading-[1.1]">
                Publish globally on custom domains with instant SSL
              </h2>

              <p className={`text-base sm:text-lg font-medium leading-relaxed max-w-lg ${
                isDark ? "text-slate-300" : "text-slate-700"
              }`}>
                Link your custom domain (<code className="bg-emerald-950/80 border border-emerald-800 px-1.5 py-0.5 rounded text-emerald-300 font-mono text-sm">yourdomain.com</code>) or host on free isolated subdomains (<code className="bg-emerald-950/80 border border-emerald-800 px-1.5 py-0.5 rounded text-emerald-300 font-mono text-sm">site.plexopages.com</code>) with automatic Vercel DNS and Blob storage management.
              </p>

              <Link
                href="/auth/register"
                className="inline-flex items-center gap-2 text-emerald-400 hover:text-emerald-300 font-bold text-base transition-colors group"
              >
                <span>Link custom domain</span>
                <div className="w-8 h-8 rounded-full border border-emerald-400 flex items-center justify-center group-hover:bg-emerald-600 group-hover:text-white transition-all">
                  <ArrowRight className="w-4 h-4" />
                </div>
              </Link>
            </div>

            {/* DNS Status Dashboard UI Card */}
            <div className="lg:col-span-6 relative flex justify-center items-center">
              <div className="relative w-full max-w-[380px] bg-slate-950 text-white rounded-3xl p-6 shadow-2xl border border-slate-800 space-y-4">
                <div className="flex items-center justify-between text-xs font-bold text-slate-300">
                  <span className="bg-slate-900 border border-slate-800 px-3 py-1 rounded-full font-mono">NEXT.JS</span>
                  <span className="bg-slate-900 border border-slate-800 px-3 py-1 rounded-full text-blue-400 font-mono">VERCEL</span>
                  <span className="bg-slate-900 border border-slate-800 px-3 py-1 rounded-full text-cyan-400 font-mono">TAILWIND</span>
                </div>

                {/* Hosting Card Graphic */}
                <div className="w-full h-44 rounded-2xl bg-gradient-to-tr from-emerald-900 via-teal-900 to-indigo-950 p-5 flex flex-col justify-between shadow-lg text-white border border-emerald-700/50">
                  <div className="flex justify-between items-center">
                    <span className="font-extrabold tracking-wider text-sm">Edge Hosting Engine</span>
                    <span className="font-mono text-xs opacity-90 bg-emerald-950 text-emerald-300 border border-emerald-700 px-2 py-0.5 rounded-full font-bold">GLOBAL CDN</span>
                  </div>
                  <div className="font-mono text-base tracking-tight font-bold text-emerald-200">
                    https://yourdomain.com
                  </div>
                  <div className="flex justify-between items-center text-[10px] opacity-90 uppercase font-mono text-slate-300">
                    <span>SSL: Active (Auto-Renew)</span>
                    <span>Latency: 14ms</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Reveal>

        {/* GRID ROW 4: Left Split Code Mockup + Right Warm Peach Card */}
        <Reveal delay={0.2}>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
            {/* Left Split Code Mockup Card */}
            <div className="lg:col-span-5 bg-gradient-to-br from-amber-950 via-slate-950 to-orange-950 rounded-[36px] p-8 border border-orange-900/60 shadow-xl flex flex-col justify-between text-white min-h-[420px]">
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-orange-800/40 pb-3 text-xs font-mono text-orange-300">
                  <span className="flex items-center gap-2">
                    <FileCode className="w-4 h-4 text-orange-400" />
                    <span>export-output.mjml</span>
                  </span>
                  <span className="text-orange-400 font-bold">CLEAN EXPORT</span>
                </div>

                <div className="space-y-2 font-mono text-xs text-slate-300 bg-slate-900/80 p-4 rounded-2xl border border-slate-800">
                  <p className="text-orange-400">&lt;mjml&gt;</p>
                  <p className="text-slate-400 pl-2">&lt;mj-body background-color=&quot;#0f172a&quot;&gt;</p>
                  <p className="text-cyan-300 pl-4">&lt;mj-section&gt;</p>
                  <p className="text-emerald-400 pl-6">&lt;mj-text&gt;100% Mailchimp Compatible&lt;/mj-text&gt;</p>
                </div>
              </div>

              <div className="space-y-2 pt-6 border-t border-orange-800/30">
                <span className="bg-orange-900/60 text-orange-200 border border-orange-700/50 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">
                  MJML / HTML5 EXPORT
                </span>
                <h3 className="text-2xl font-extrabold">Zero vendor lock-in code</h3>
              </div>
            </div>

            {/* Right Warm Peach Card (Export & Eject) */}
            <div className={`lg:col-span-7 rounded-[36px] p-8 sm:p-12 flex flex-col justify-between overflow-hidden relative border shadow-xl min-h-[420px] transition-colors ${
              isDark
                ? "bg-[#1c1410] border-orange-900/40 text-white"
                : "bg-[#fde8d7] border-orange-100 text-slate-950"
            }`}>
              <div className="space-y-6 max-w-md z-10">
                <span className="text-xs font-bold tracking-widest text-orange-400 uppercase">
                  EXPORT &amp; EJECT
                </span>

                <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight leading-[1.1]">
                  Export production-ready HTML5 &amp; MJML code
                </h2>

                <p className={`text-base sm:text-lg font-medium leading-relaxed ${
                  isDark ? "text-slate-300" : "text-slate-700"
                }`}>
                  Zero vendor lock-in. Export clean, formatted HTML5/CSS3 for web pages or standard MJML for email clients. Or eject to raw code editing anytime.
                </p>

                <Link
                  href="/auth/register"
                  className="inline-flex items-center gap-2 text-orange-400 hover:text-orange-300 font-bold text-base transition-colors group"
                >
                  <span>Export clean code</span>
                  <div className="w-8 h-8 rounded-full border border-orange-400 flex items-center justify-center group-hover:bg-orange-600 group-hover:text-white transition-all">
                    <ArrowRight className="w-4 h-4" />
                  </div>
                </Link>
              </div>

              {/* Stacked Live Alert Notification Mockup */}
              <div className="mt-8 self-end w-full max-w-sm bg-slate-950 text-white rounded-2xl p-4 shadow-xl border border-slate-800 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-slate-900 text-emerald-400 flex items-center justify-center border border-slate-800">
                  <CheckCircle className="w-5 h-5" />
                </div>
                <div className="text-xs space-y-0.5">
                  <p className="font-extrabold text-white">Page Published</p>
                  <p className="text-slate-400 font-medium">site.plexopages.com is live in 0.4s with SSL enabled</p>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
