"use client";

import { useState } from "react";
import { Bot, Terminal, Cpu, Check, Copy, Sparkles, Layers, Zap } from "lucide-react";
import { Reveal } from "@/app/scroll-fx";

export function DevMcpSection({ isDark }: { isDark: boolean }) {
  const [copied, setCopied] = useState(false);

  const mcpConfigJson = `{
  "mcpServers": {
    "plexo": {
      "command": "npx",
      "args": ["-y", "@charisol/plexo-mcp@latest"],
      "env": {
        "PLEXO_API_KEY": "plx_live_your_key_here",
        "PLEXO_APP_URL": "https://plexo.app"
      }
    }
  }
}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(mcpConfigJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section id="mcp" className={`py-20 md:py-28 px-4 sm:px-8 md:px-16 transition-colors duration-500 font-['Mulish',sans-serif] ${
      isDark ? "bg-[#080b12] text-white" : "bg-white text-slate-950"
    }`}>
      <div className="max-w-7xl mx-auto space-y-16">
        {/* Header */}
        <div className="max-w-3xl space-y-4">
          <Reveal>
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-extrabold bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <Bot className="w-3.5 h-3.5 text-purple-400" />
              <span>NATIVE MCP SERVER</span>
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight">
              Plexo MCP Server for AI Agents
            </h2>
          </Reveal>

          <Reveal delay={0.2}>
            <p className={`text-base sm:text-lg font-medium leading-relaxed ${
              isDark ? "text-slate-400" : "text-slate-600"
            }`}>
              Connect Cursor, Antigravity, Claude Desktop, or ChatGPT to your Plexo workspace. Prompt AI assistants to generate, edit, link custom domains, or publish pages autonomously.
            </p>
          </Reveal>
        </div>

        {/* 2-Column Grid: Config Box + MCP Tool List */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-stretch">
          {/* Left Config Box */}
          <div className="lg:col-span-6">
            <Reveal delay={0.1}>
              <div className="bg-[#0b0f19] text-white rounded-3xl border border-slate-800 shadow-2xl overflow-hidden h-full flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3 text-xs font-mono text-slate-400">
                    <span className="flex items-center gap-2 text-purple-400 font-bold">
                      <Terminal className="w-4 h-4" />
                      <span>claude_desktop_config.json</span>
                    </span>
                    <button
                      onClick={handleCopy}
                      className="flex items-center gap-1.5 hover:text-white transition-colors"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copied ? "Copied" : "Copy"}</span>
                    </button>
                  </div>

                  <pre className="p-6 font-mono text-xs leading-relaxed text-purple-300 overflow-x-auto">
                    <code>{mcpConfigJson}</code>
                  </pre>
                </div>

                <div className="p-5 bg-slate-950 border-t border-slate-800 flex justify-between items-center text-xs font-mono text-slate-400">
                  <span>Package: @charisol/plexo-mcp</span>
                  <span className="text-purple-400 font-bold">MCP Protocol 1.0</span>
                </div>
              </div>
            </Reveal>
          </div>

          {/* Right MCP Tools Matrix */}
          <div className="lg:col-span-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Reveal delay={0.15}>
              <div className={`p-5 rounded-2xl border shadow-md space-y-2 transition-colors ${
                isDark ? "bg-[#121724] border-slate-800 text-white" : "bg-slate-50 border-slate-200 text-slate-950"
              }`}>
                <span className="text-[11px] font-mono font-bold text-purple-400 block">tool: create_landing_page</span>
                <h4 className="text-sm font-extrabold">Autonomous Page Creation</h4>
                <p className={`text-xs ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                  Generates multi-page visual templates or raw HTML pages from natural language prompts.
                </p>
              </div>
            </Reveal>

            <Reveal delay={0.2}>
              <div className={`p-5 rounded-2xl border shadow-md space-y-2 transition-colors ${
                isDark ? "bg-[#121724] border-slate-800 text-white" : "bg-slate-50 border-slate-200 text-slate-950"
              }`}>
                <span className="text-[11px] font-mono font-bold text-cyan-400 block">tool: linkDomainToTemplate</span>
                <h4 className="text-sm font-extrabold">Custom Domain Binding</h4>
                <p className={`text-xs ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                  Links custom domains to published templates with Vercel DNS and TLS provisioning.
                </p>
              </div>
            </Reveal>

            <Reveal delay={0.25}>
              <div className={`p-5 rounded-2xl border shadow-md space-y-2 transition-colors ${
                isDark ? "bg-[#121724] border-slate-800 text-white" : "bg-slate-50 border-slate-200 text-slate-950"
              }`}>
                <span className="text-[11px] font-mono font-bold text-emerald-400 block">tool: duplicate_landing_page</span>
                <h4 className="text-sm font-extrabold">Template &amp; Blob Cloning</h4>
                <p className={`text-xs ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                  Duplicates visual blocks and asset blobs cleanly across sub-page hierarchies.
                </p>
              </div>
            </Reveal>

            <Reveal delay={0.3}>
              <div className={`p-5 rounded-2xl border shadow-md space-y-2 transition-colors ${
                isDark ? "bg-[#121724] border-slate-800 text-white" : "bg-slate-50 border-slate-200 text-slate-950"
              }`}>
                <span className="text-[11px] font-mono font-bold text-orange-400 block">tool: create_commerce_product</span>
                <h4 className="text-sm font-extrabold">Digital Products &amp; Payments</h4>
                <p className={`text-xs ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                  Lists a digital download or service, manages orders, and switches a site between its own Paystack keys or Plexo's Paystack/Stripe.
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
