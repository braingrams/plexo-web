"use client";

import Link from "next/link";
import { useState } from "react";
import { Code, Layers, Globe, ShieldCheck, Check, Copy } from "lucide-react";
import { Reveal } from "@/app/scroll-fx";
import { SDK_V2_SHORT } from "@/app/sdk/v2-snippets";

export function DevSdkSection({ isDark }: { isDark: boolean }) {
  const [copied, setCopied] = useState(false);

  const codeSnippet = SDK_V2_SHORT;

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
              Plexo SDK 2 for React &amp; Next.js
            </h2>
          </Reveal>

          <Reveal delay={0.2}>
            <p className={`text-base sm:text-lg font-medium leading-relaxed ${
              isDark ? "text-slate-400" : "text-slate-600"
            }`}>
              Give your users a visual website builder inside your own product. They edit pages section by section, you keep the pages in your database and compile them to clean HTML or React.
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
                      <span>site-editor.tsx</span>
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
                  <span>Package: @charisol/plexo-sdk (SDK 2)</span>
                  <Link href="/sdk" className="text-emerald-400 font-bold hover:underline">Full guide →</Link>
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
                <h3 className="text-lg font-extrabold">Section by section, for anyone</h3>
                <p className={`text-xs font-medium leading-relaxed ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                  Pages are built from ready-made sections that people edit by clicking and typing. Brand colours and fonts stay in sync through one design system, with Strata.
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
                <h3 className="text-lg font-extrabold">Clean HTML or React out</h3>
                <p className={`text-xs font-medium leading-relaxed ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                  Compile any page on your server with <code className="font-mono text-purple-400">compilePageToHtml</code>, or call <code className="font-mono text-purple-400">/api/v1/compile-v2</code>. Forms post to your own address with <code className="font-mono text-purple-400">formAction</code>.
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
                <h3 className="text-lg font-extrabold">Classic builder keeps working</h3>
                <p className={`text-xs font-medium leading-relaxed ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                  Already using <code className="font-mono text-purple-400">&lt;PlexoBuilder /&gt;</code>? It is unchanged, with the same API key and endpoints. See the classic docs when you are ready to compare.
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
