"use client";

import React, { useState } from "react";
import Link from "next/link";
import { LandingNav } from "../landing-nav";
import {
  Bot,
  Sparkles,
  Zap,
  Globe,
  Terminal,
  Code2,
  BarChart3,
  Copy,
  Check,
  CheckCircle2,
  ArrowRight,
  ShieldCheck,
  Layers,
  FileCode2,
  ExternalLink,
  Laptop,
  Cpu,
  Lock,
  Info,
} from "lucide-react";

type McpLandingClientProps = {
  baseUrl: string;
};

export default function McpLandingClient({ baseUrl }: McpLandingClientProps) {
  const [activeTab, setActiveTab] = useState<"prompt" | "analytics" | "templates" | "profile">("prompt");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const samplePrompts = {
    prompt: {
      userPrompt: "Generate a modern dark-mode SaaS landing page for an AI CRM called Acme and publish it to subdomain 'acme-crm'",
      aiResult: {
        status: "success",
        action: "Plexo MCP Server -> publishLandingPage",
        templateName: "Acme AI CRM Landing Page",
        subdomain: "acme-crm.plexobuilder.com",
        publishedUrl: "https://acme-crm.plexobuilder.com",
        editableUrl: "https://plexobuilder.com/dashboard/templates/t_982a17f",
        compiledStatus: "Compiled 100% valid Plexo JSON & HTML bundle with responsive hero, features, and form.",
      },
    },
    analytics: {
      userPrompt: "Show my page view analytics and unique visitor metrics for the past 7 days",
      aiResult: {
        status: "success",
        action: "Plexo MCP Server -> getAnalytics",
        totalViews: 4280,
        totalUniqueVisitors: 1940,
        topDomain: "acme-crm.plexobuilder.com (2,120 views)",
        growth: "+34% increase vs previous week",
      },
    },
    templates: {
      userPrompt: "List all my saved email templates and landing page drafts",
      aiResult: {
        status: "success",
        action: "Plexo MCP Server -> listTemplates",
        landingPages: [
          { name: "Acme AI CRM", published: "https://acme-crm.plexobuilder.com", status: "LIVE" },
          { name: "SaaS Launch Waitlist", published: "https://launch.plexobuilder.com", status: "LIVE" },
        ],
        emailTemplates: [
          { name: "Monthly Product Newsletter", kind: "EMAIL", status: "SAVED" },
          { name: "User Onboarding Welcome", kind: "EMAIL", status: "SAVED" },
        ],
      },
    },
    profile: {
      userPrompt: "Check my Plexo account plan, active domain count, and remaining AI credits",
      aiResult: {
        status: "success",
        action: "Plexo MCP Server -> getUserProfile",
        plan: "PRO",
        domainsUsed: "2 / 10 published domains",
        templatesUsed: "5 / 20 templates",
        totalCredits: "18,400 remaining AI credits",
      },
    },
  };

  const currentSample = samplePrompts[activeTab];

  return (
    <div className="min-h-screen bg-[#08090f] text-[#f0f2ff] font-sans selection:bg-[#8b5cf6] selection:text-white">
      <LandingNav />

      {/* ── Main Container ───────────────────────────────────── */}
      <main className="pt-28 pb-20 px-4 md:px-6 max-w-[1400px] mx-auto space-y-16">
        {/* ── HERO SECTION ───────────────────────────────────── */}
        <section className="text-center max-w-3xl mx-auto space-y-6 pt-4">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#8b5cf6]/10 border border-[#8b5cf6]/20 text-[#a78bfa] text-xs font-bold backdrop-blur-md uppercase tracking-wider">
            <Sparkles className="w-3.5 h-3.5 text-[#8b5cf6]" />
            Model Context Protocol (@charisol/plexo-mcp)
          </div>

          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-white leading-tight">
            Prompt Any AI to <span className="bg-gradient-to-r from-[#a78bfa] via-[#818cf8] to-[#34d399] bg-clip-text text-transparent">Generate & Publish</span> Web Pages
          </h1>

          <p className="text-sm md:text-base text-[#f0f2ff]/70 max-w-2xl mx-auto leading-relaxed">
            Connect <strong className="text-white">Claude Desktop</strong>, <strong className="text-white">ChatGPT</strong>, <strong className="text-white">Cursor</strong>, and <strong className="text-white">Gemini</strong> to Plexo. Create landing pages, compile responsive HTML, publish to custom subdomains, and inspect analytics via plain language.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
            <Link
              href="/auth/register"
              className="px-6 py-3.5 rounded-2xl bg-gradient-to-r from-[#8b5cf6] to-[#7c3aed] hover:opacity-95 text-white text-sm font-bold shadow-xl shadow-[#8b5cf6]/25 flex items-center gap-2 transition"
            >
              Get Your MCP API Key
              <ArrowRight className="w-4 h-4" />
            </Link>

            <a
              href="#setup-guides"
              className="px-6 py-3.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-white/90 text-sm font-semibold transition"
            >
              View Connection Guides
            </a>
          </div>
        </section>

        {/* ── INTERACTIVE PROMPT DEMO ───────────────────────────── */}
        <section className="bg-[#111827]/90 border border-white/10 rounded-3xl p-6 md:p-8 shadow-2xl backdrop-blur-xl space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-5">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Terminal className="w-5 h-5 text-[#8b5cf6]" />
                Live MCP Tool Call Simulation
              </h2>
              <p className="text-xs text-white/50">Click a scenario to see how Plexo MCP processes AI prompts under the hood.</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {[
                { id: "prompt", label: "Publish Page", icon: Zap },
                { id: "analytics", label: "Page Analytics", icon: BarChart3 },
                { id: "templates", label: "List Templates", icon: Layers },
                { id: "profile", label: "Account Limits", icon: Cpu },
              ].map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 transition ${
                      active
                        ? "bg-[#8b5cf6] text-white shadow-md shadow-[#8b5cf6]/30 font-bold"
                        : "bg-white/[0.04] text-white/60 hover:text-white border border-white/10"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Chat Bubble & Response Mock */}
          <div className="grid md:grid-cols-2 gap-6 items-start">
            <div className="bg-[#08090f] border border-white/10 rounded-2xl p-5 space-y-4">
              <div className="flex items-center gap-2 text-xs text-[#a78bfa] font-mono">
                <Bot className="w-4 h-4" />
                Prompt (User Input in Claude / Cursor)
              </div>
              <p className="text-sm font-medium text-white bg-white/[0.03] border border-white/10 rounded-xl p-4 leading-relaxed">
                "{currentSample.userPrompt}"
              </p>
            </div>

            <div className="bg-[#08090f] border border-[#8b5cf6]/30 rounded-2xl p-5 space-y-3 shadow-lg shadow-[#8b5cf6]/10">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-[#34d399] flex items-center gap-1.5 font-bold">
                  <CheckCircle2 className="w-4 h-4" />
                  {currentSample.aiResult.action}
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#34d399]/10 text-[#34d399] border border-[#34d399]/20">
                  200 OK
                </span>
              </div>

              <pre className="text-xs font-mono bg-black/60 border border-white/10 rounded-xl p-4 text-white/80 overflow-x-auto leading-relaxed">
                {JSON.stringify(currentSample.aiResult, null, 2)}
              </pre>
            </div>
          </div>
        </section>

        {/* ── SETUP GUIDES SECTION ───────────────────────────────── */}
        <section id="setup-guides" className="space-y-8">
          <div className="text-center max-w-2xl mx-auto space-y-2">
            <h2 className="text-2xl md:text-3xl font-extrabold text-white">Connection Guides</h2>
            <p className="text-xs md:text-sm text-white/60">1-minute setup for Claude Desktop, Cursor IDE, Windsurf, and ChatGPT.</p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Claude Desktop Config */}
            <div className="bg-[#111827]/80 border border-white/10 rounded-3xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Laptop className="w-4 h-4 text-[#8b5cf6]" />
                  Claude Desktop Configuration
                </h3>
                <button
                  onClick={() => handleCopy(`{\n  "mcpServers": {\n    "plexo": {\n      "command": "npx",\n      "args": ["-y", "@charisol/plexo-mcp"],\n      "env": {\n        "PLEXO_API_KEY": "plexo_sk_your_key_here"\n      }\n    }\n  }\n}`, "claude")}
                  className="px-2.5 py-1 rounded-lg bg-white/[0.05] hover:bg-white/10 text-xs text-white/80 border border-white/10 flex items-center gap-1 transition"
                >
                  {copiedId === "claude" ? <Check className="w-3 h-3 text-[#34d399]" /> : <Copy className="w-3 h-3" />}
                  {copiedId === "claude" ? "Copied" : "Copy"}
                </button>
              </div>

              <p className="text-xs text-white/60">
                Add to your <code className="text-[#a78bfa]">claude_desktop_config.json</code>:
              </p>

              <pre className="text-xs font-mono bg-black/60 border border-white/10 rounded-xl p-4 text-[#a78bfa] overflow-x-auto leading-relaxed">
{`{
  "mcpServers": {
    "plexo": {
      "command": "npx",
      "args": ["-y", "@charisol/plexo-mcp"],
      "env": {
        "PLEXO_API_KEY": "plexo_sk_your_key_here"
      }
    }
  }
}`}
              </pre>
            </div>

            {/* Cursor IDE Config */}
            <div className="bg-[#111827]/80 border border-white/10 rounded-3xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Code2 className="w-4 h-4 text-[#38bdf8]" />
                  Cursor & Windsurf Config
                </h3>
                <button
                  onClick={() => handleCopy(`{\n  "mcpServers": {\n    "plexo": {\n      "command": "npx",\n      "args": ["-y", "@charisol/plexo-mcp"],\n      "env": {\n        "PLEXO_API_KEY": "plexo_sk_your_key_here"\n      }\n    }\n  }\n}`, "cursor")}
                  className="px-2.5 py-1 rounded-lg bg-white/[0.05] hover:bg-white/10 text-xs text-white/80 border border-white/10 flex items-center gap-1 transition"
                >
                  {copiedId === "cursor" ? <Check className="w-3 h-3 text-[#34d399]" /> : <Copy className="w-3 h-3" />}
                  {copiedId === "cursor" ? "Copied" : "Copy"}
                </button>
              </div>

              <p className="text-xs text-white/60">
                Add to your project's <code className="text-[#38bdf8]">.cursor/mcp.json</code>:
              </p>

              <pre className="text-xs font-mono bg-black/60 border border-white/10 rounded-xl p-4 text-[#38bdf8] overflow-x-auto leading-relaxed">
{`{
  "mcpServers": {
    "plexo": {
      "command": "npx",
      "args": ["-y", "@charisol/plexo-mcp"],
      "env": {
        "PLEXO_API_KEY": "plexo_sk_your_key_here"
      }
    }
  }
}`}
              </pre>
            </div>
          </div>
        </section>

        {/* ── CALL TO ACTION ────────────────────────────────────── */}
        <section className="text-center bg-gradient-to-r from-[#8b5cf6]/15 to-[#7c3aed]/15 border border-[#8b5cf6]/30 rounded-3xl p-10 space-y-6">
          <h2 className="text-2xl md:text-3xl font-extrabold text-white">Start Commanding Your Landing Pages with AI</h2>
          <p className="text-sm text-white/60 max-w-xl mx-auto">Generate your Plexo API key and connect your favorite AI assistant today.</p>
          <Link
            href="/auth/register"
            className="inline-flex items-center gap-2 px-8 py-3.5 rounded-2xl bg-gradient-to-r from-[#8b5cf6] to-[#7c3aed] hover:opacity-95 text-white text-sm font-bold shadow-xl shadow-[#8b5cf6]/30 transition"
          >
            Get Free API Key
            <ArrowRight className="w-4 h-4" />
          </Link>
        </section>
      </main>
    </div>
  );
}
