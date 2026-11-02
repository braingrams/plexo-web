"use client";

import { Bot, Zap, FileText } from "lucide-react";
import { Reveal } from "@/app/scroll-fx";

export function V2CommunitySection({ isDark }: { isDark: boolean }) {
  return (
    <section className={`py-20 md:py-28 px-4 sm:px-8 md:px-16 transition-colors duration-500 font-['Mulish',sans-serif] ${
      isDark ? "bg-[#0b0f19] text-white" : "bg-white text-slate-950"
    }`}>
      <div className="max-w-7xl mx-auto">
        <Reveal>
          <div className={`rounded-[36px] p-8 sm:p-12 md:p-16 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center shadow-xl border transition-colors ${
            isDark
              ? "bg-[#181226] border-purple-900/50 text-white"
              : "bg-[#fdf0f5] border-pink-100 text-slate-950"
          }`}>
            {/* Left Text Column */}
            <div className="lg:col-span-6 space-y-6">
              <div className="text-4xl sm:text-5xl select-none">
                <Zap className="w-10 h-10 sm:w-12 sm:h-12" strokeWidth={1.8} />
              </div>

              <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight leading-[1.1]">
                Built for creators, developers &amp; AI agents
              </h2>

              <p className={`text-base sm:text-lg font-medium leading-relaxed max-w-lg ${
                isDark ? "text-slate-300" : "text-slate-700"
              }`}>
                At Plexo, we believe page and email building should be fast, flexible, and open. Whether you build visually with drag-and-drop, code in raw HTML/CSS, or prompt via connected AI agents, Plexo gives you total freedom without lock-in.
              </p>
            </div>

            {/* Right Visual UI Mockup */}
            <div className="lg:col-span-6 flex justify-center">
              <div className="relative w-full max-w-[460px] bg-slate-950 text-white rounded-[32px] p-6 shadow-2xl border border-purple-800/40 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3 text-xs font-mono">
                  <span className="flex items-center gap-2 text-purple-400">
                    <Bot className="w-4 h-4" />
                    <span>mcp-agent-network</span>
                  </span>
                  <span className="bg-purple-900/80 text-purple-200 px-2 py-0.5 rounded-full text-[10px] font-bold">
                    MULTI-MODEL
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-3 pt-2 text-center text-xs font-mono">
                  <div className="bg-slate-900 p-3 rounded-2xl border border-slate-800 space-y-1">
                    <span className="flex justify-center"><Zap className="w-5 h-5" /></span>
                    <span className="font-bold text-white block">Visual</span>
                    <span className="text-[10px] text-slate-400">Canvas</span>
                  </div>
                  <div className="bg-slate-900 p-3 rounded-2xl border border-slate-800 space-y-1">
                    <span className="flex justify-center"><FileText className="w-5 h-5" /></span>
                    <span className="font-bold text-white block">Raw Code</span>
                    <span className="text-[10px] text-slate-400">HTML/CSS</span>
                  </div>
                  <div className="bg-slate-900 p-3 rounded-2xl border border-slate-800 space-y-1">
                    <span className="flex justify-center"><Bot className="w-5 h-5" /></span>
                    <span className="font-bold text-white block">AI Agent</span>
                    <span className="text-[10px] text-slate-400">MCP Sync</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
