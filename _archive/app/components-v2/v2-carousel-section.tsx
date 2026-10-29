"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Layers, Sparkles, Code, Cpu } from "lucide-react";
import { Reveal } from "@/app/scroll-fx";

const CAROUSEL_ITEMS = [
  {
    tag: "DRAG & DROP CANVAS",
    title: "Intuitive Page & Email Builder",
    description: "Design pixel-perfect, responsive layouts visually. Drag & drop blocks, customize brand tokens, and preview in real time.",
    codeBadge: "Visual Studio 2.0",
    color: "from-purple-600 to-indigo-600",
  },
  {
    tag: "MCP SERVER AGENT",
    title: "AI Prompt Page Generation",
    description: "Connect Claude Desktop, Cursor, or Antigravity via MCP. Prompt AI to generate, duplicate, or update landing pages autonomously.",
    codeBadge: "MCP Agent Enabled",
    color: "from-indigo-600 to-cyan-600",
  },
  {
    tag: "ZERO LOCK-IN EXPORT",
    title: "Production HTML5 & MJML Exports",
    description: "Export clean, formatted HTML5/CSS3 for web pages or standard MJML for email campaigns. Eject to raw code editing anytime.",
    codeBadge: "Clean Code Export",
    color: "from-purple-600 to-pink-600",
  },
];

export function V2CarouselSection({ isDark }: { isDark: boolean }) {
  const [currentIndex, setCurrentIndex] = useState(0);

  const nextItem = () => setCurrentIndex((prev) => (prev + 1) % CAROUSEL_ITEMS.length);
  const prevItem = () => setCurrentIndex((prev) => (prev === 0 ? CAROUSEL_ITEMS.length - 1 : prev - 1));

  const current = CAROUSEL_ITEMS[currentIndex];

  return (
    <section className={`py-20 md:py-28 px-4 sm:px-8 md:px-16 transition-colors duration-500 font-['Mulish',sans-serif] ${
      isDark ? "bg-[#080b12] text-white" : "bg-slate-50 text-slate-950"
    }`}>
      <div className="max-w-7xl mx-auto space-y-12">
        {/* Header */}
        <Reveal>
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div className="space-y-4 max-w-2xl">
              <span className="text-xs font-bold tracking-widest text-purple-400 uppercase">
                FEATURE SHOWCASE
              </span>
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight leading-[1.1]">
                Everything you need to build &amp; publish
              </h2>
            </div>

            {/* Navigation Arrows */}
            <div className="flex items-center gap-3">
              <button
                onClick={prevItem}
                aria-label="Previous Feature"
                className={`w-12 h-12 rounded-full border flex items-center justify-center transition-all ${
                  isDark
                    ? "bg-slate-900 border-slate-800 text-white hover:bg-slate-800"
                    : "bg-white border-slate-200 text-slate-950 hover:bg-slate-100 shadow-md"
                }`}
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <button
                onClick={nextItem}
                aria-label="Next Feature"
                className={`w-12 h-12 rounded-full border flex items-center justify-center transition-all ${
                  isDark
                    ? "bg-slate-900 border-slate-800 text-white hover:bg-slate-800"
                    : "bg-white border-slate-200 text-slate-950 hover:bg-slate-100 shadow-md"
                }`}
              >
                <ArrowRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        </Reveal>

        {/* Interactive Feature Card */}
        <Reveal delay={0.15}>
          <div className={`rounded-[36px] p-8 sm:p-12 md:p-16 border shadow-2xl transition-all duration-500 relative overflow-hidden ${
            isDark ? "bg-[#111625] border-slate-800 text-white" : "bg-white border-slate-200 text-slate-950"
          }`}>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
              <div className="lg:col-span-7 space-y-6">
                <span className="bg-purple-500/10 text-purple-400 border border-purple-500/20 px-3.5 py-1.5 rounded-full text-xs font-mono font-bold tracking-wider inline-block">
                  {current.tag}
                </span>

                <h3 className="text-3xl sm:text-4xl font-extrabold tracking-tight leading-snug">
                  {current.title}
                </h3>

                <p className={`text-base sm:text-lg font-medium leading-relaxed max-w-xl ${
                  isDark ? "text-slate-300" : "text-slate-600"
                }`}>
                  {current.description}
                </p>
              </div>

              {/* Graphic Display Window */}
              <div className="lg:col-span-5 flex justify-center">
                <div className={`w-full max-w-[380px] h-64 rounded-3xl bg-gradient-to-br ${current.color} p-6 flex flex-col justify-between text-white shadow-2xl relative overflow-hidden border border-white/20`}>
                  <div className="flex justify-between items-center text-xs font-mono">
                    <span className="font-bold">Plexo Platform</span>
                    <span className="bg-white/20 backdrop-blur-md px-2.5 py-1 rounded-full text-[10px] font-bold">
                      {current.codeBadge}
                    </span>
                  </div>

                  <div className="space-y-2">
                    <div className="h-3 w-3/4 bg-white/40 rounded-full" />
                    <div className="h-3 w-1/2 bg-white/20 rounded-full" />
                  </div>

                  <div className="flex items-center justify-between text-[11px] font-mono opacity-90 border-t border-white/20 pt-3">
                    <span>100% Production Ready</span>
                    <Sparkles className="w-4 h-4 text-yellow-300" />
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
