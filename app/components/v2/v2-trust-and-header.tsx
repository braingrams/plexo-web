"use client";

import { ShieldCheck, Zap, Sparkles, MessageSquare } from "lucide-react";
import { Reveal } from "@/app/scroll-fx";

export function V2TrustAndHeader({ isDark }: { isDark: boolean }) {
  return (
    <section className={`py-10 md:py-14 px-4 sm:px-8 md:px-16 overflow-hidden transition-colors duration-500 font-['Mulish',sans-serif] ${
      isDark ? "bg-[#0b0f19] text-white" : "bg-white text-slate-950"
    }`}>
      <div className="max-w-7xl mx-auto space-y-10">
        {/* INTEGRATES SEAMLESSLY WITH Logo Cloud */}
        <Reveal>
          <div className={`flex flex-col md:flex-row items-center justify-between gap-8 border-b pb-14 ${
            isDark ? "border-slate-800/80" : "border-slate-100"
          }`}>
            <span className={`text-xs font-extrabold tracking-widest uppercase ${
              isDark ? "text-slate-400" : "text-slate-500"
            }`}>
              INTEGRATES SEAMLESSLY WITH
            </span>

            <div className={`flex flex-wrap items-center justify-center md:justify-end gap-8 sm:gap-10 font-bold text-base sm:text-lg ${
              isDark ? "text-slate-300" : "text-slate-700"
            }`}>
              {/* Next.js */}
              <div className="flex items-center gap-2 hover:text-purple-400 transition-colors font-mono">
                <span className="text-lg">▲</span>
                <span>Next.js</span>
              </div>

              {/* React */}
              <div className="flex items-center gap-2 hover:text-purple-400 transition-colors">
                <span className="text-lg text-cyan-400">⚛</span>
                <span>React</span>
              </div>

              {/* Node.js */}
              <div className="flex items-center gap-2 hover:text-purple-400 transition-colors font-mono">
                <span className="text-lg text-emerald-500">⬡</span>
                <span>Node.js</span>
              </div>

              {/* Claude */}
              <div className="flex items-center gap-2 hover:text-purple-400 transition-colors">
                <Sparkles className="w-4 h-4 text-orange-400" />
                <span>Claude</span>
              </div>

              {/* ChatGPT */}
              <div className="flex items-center gap-2 hover:text-purple-400 transition-colors">
                <MessageSquare className="w-4 h-4 text-teal-400" />
                <span>ChatGPT</span>
              </div>
            </div>
          </div>
        </Reveal>

        {/* Security & Edge Shield Badge */}
        <div className="flex flex-col items-center justify-center text-center">
          <Reveal delay={0.1}>
            <div className="w-16 h-16 rounded-full bg-purple-700 text-white flex flex-col items-center justify-center shadow-xl border-2 border-purple-800 mb-6 p-2 mx-auto">
              <ShieldCheck className="w-6 h-6 text-white mb-0.5" />
              <span className="text-[8px] font-extrabold tracking-widest leading-none">VERCEL</span>
              <span className="text-[6px] opacity-80 leading-none">EDGE SECURED</span>
            </div>
          </Reveal>

          {/* Section Headline */}
          <Reveal delay={0.2}>
            <div className="relative max-w-4xl mx-auto text-center space-y-3">
              <Sparkles className="absolute -top-6 -left-2 sm:-left-8 w-5 h-5 text-purple-400 animate-pulse" />
              <Sparkles className="absolute top-2 -right-2 sm:-right-8 w-4 h-4 text-indigo-400 animate-pulse delay-300" />
              <Sparkles className="absolute -bottom-4 left-4 sm:left-10 w-4 h-4 text-purple-300" />

              <h2 className="text-2xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight">
                No Limits, No Code Lock-in
              </h2>

              <div className="flex flex-wrap sm:flex-nowrap items-center justify-center gap-3 text-2xl sm:text-4xl md:text-5xl font-extrabold">
                <span className="bg-gradient-to-r from-purple-500 via-indigo-500 to-blue-500 bg-clip-text text-transparent">
                  Publish anywhere
                </span>

                {/* Purple Toggle Switch Pill */}
                <div className="w-12 sm:w-14 h-7 sm:h-8 bg-purple-600 rounded-full p-1 flex items-center justify-end shadow-inner">
                  <div className="w-5 sm:w-6 h-5 sm:h-6 bg-white rounded-full flex items-center justify-center shadow-md">
                    <Zap className="w-3 h-3.5 text-purple-600 fill-purple-600" />
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
