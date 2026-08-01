"use client";

import { useState } from "react";
import { Code, Layers, Globe, ShieldCheck, Check, Copy, ArrowRight, Zap } from "lucide-react";
import { Reveal } from "@/app/scroll-fx";

export function DevSdkSection({ isDark }: { isDark: boolean }) {
  const [copied, setCopied] = useState(false);

  const codeSnippet = `import { PlexoBuilder } from "@charisol/plexo-sdk";

export default function SaaSPageEditor() {
  return (
    <div className="h-screen w-full">
      <PlexoBuilder
        mode="landing_page"
        apiKey={process.env.NEXT_PUBLIC_PLEXO_API_KEY}
        useAi
        onSave={({ json, html }) => console.log("Saved:", html)}
      />
    </div>
  );
}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(codeSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section id="sdk" className={`py-20 md:py-28 px-4 sm:px-8 md:px-16 transition-colors duration-500 font-['Mulish',sans-serif] ${
      isDark ? "bg-[#0b0f19] text-white" : "bg-slate-50 text-slate-950"
    }`}>
      <div className="max-w-7xl mx-auto space-y-16">
        {/* Header */}
        <div className="max-w-3xl space-y-4">
          <Reveal>
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-extrabold bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <Code className="w-3.5 h-3.5" />
              <span>EMBEDDABLE SDK</span>
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight">
              Plexo SDK for Next.js &amp; React
            </h2>
          </Reveal>

          <Reveal delay={0.2}>
            <p className={`text-base sm:text-lg font-medium leading-relaxed ${
              isDark ? "text-slate-400" : "text-slate-600"
            }`}>
              Embed the complete drag-and-drop web and email builder directly into your SaaS application with full customization and event callbacks.
            </p>
          </Reveal>
        </div>

        {/* 2-Column Section: Left Code Snippet, Right Feature Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-stretch">
          {/* Left Code Snippet Box */}
          <div className="lg:col-span-7">
            <Reveal delay={0.1}>
              <div className="bg-[#090d16] text-white rounded-3xl border border-slate-800 shadow-2xl overflow-hidden h-full flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3 text-xs font-mono text-slate-400">
                    <span className="flex items-center gap-2 text-purple-400 font-bold">
                      <Code className="w-4 h-4" />
                      <span>SaaSPageEditor.tsx</span>
                    </span>
                    <button
                      onClick={handleCopy}
                      className="flex items-center gap-1.5 hover:text-white transition-colors"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copied ? "Copied" : "Copy"}</span>
                    </button>
                  </div>

                  <pre className="p-6 font-mono text-xs leading-relaxed text-slate-300 overflow-x-auto">
                    <code>{codeSnippet}</code>
                  </pre>
                </div>

                <div className="p-5 bg-slate-950 border-t border-slate-800 flex justify-between items-center text-xs font-mono text-slate-400">
                  <span>Package: @charisol/plexo-sdk@1.0.40</span>
                  <span className="text-emerald-400 font-bold">● Production Ready</span>
                </div>
              </div>
            </Reveal>
          </div>

          {/* Right Feature Grid */}
          <div className="lg:col-span-5 grid grid-cols-1 gap-6">
            <Reveal delay={0.15}>
              <div className={`p-6 rounded-3xl border shadow-lg space-y-3 transition-colors ${
                isDark ? "bg-[#121724] border-slate-800 text-white" : "bg-white border-slate-200 text-slate-950"
              }`}>
                <div className="w-10 h-10 rounded-2xl bg-purple-500/10 text-purple-400 flex items-center justify-center border border-purple-500/20">
                  <Layers className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-extrabold">Visual &amp; Raw Mode Switching</h3>
                <p className={`text-xs font-medium leading-relaxed ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                  Switch between visual drag-and-drop canvas and raw HTML/CSS editing. Trigger eject callbacks to save raw HTML to your own storage.
                </p>
              </div>
            </Reveal>

            <Reveal delay={0.2}>
              <div className={`p-6 rounded-3xl border shadow-lg space-y-3 transition-colors ${
                isDark ? "bg-[#121724] border-slate-800 text-white" : "bg-white border-slate-200 text-slate-950"
              }`}>
                <div className="w-10 h-10 rounded-2xl bg-teal-500/10 text-teal-400 flex items-center justify-center border border-teal-500/20">
                  <Globe className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-extrabold">Custom Domain Binding</h3>
                <p className={`text-xs font-medium leading-relaxed ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                  Pass <code className="font-mono text-purple-400">customDomain</code> props to automatically bind customer domains to Vercel DNS and Blob assets.
                </p>
              </div>
            </Reveal>

            <Reveal delay={0.25}>
              <div className={`p-6 rounded-3xl border shadow-lg space-y-3 transition-colors ${
                isDark ? "bg-[#121724] border-slate-800 text-white" : "bg-white border-slate-200 text-slate-950"
              }`}>
                <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center border border-emerald-500/20">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-extrabold">Tenant Security &amp; Isolation</h3>
                <p className={`text-xs font-medium leading-relaxed ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                  Multi-tenant API keys and origin restrictions safeguard data and prevent cross-account leaks.
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
