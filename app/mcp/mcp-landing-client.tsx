"use client";

import React, { useState } from "react";
import Link from "next/link";
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
  Play,
  Lock,
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

  const claudeSnippet = JSON.stringify(
    {
      mcpServers: {
        plexo: {
          command: "npx",
          args: ["-y", "@plexo/mcp"],
          env: {
            PLEXO_API_KEY: "plexo_sk_your_api_key_here",
          },
        },
      },
    },
    null,
    2
  );

  return (
    <div className="min-h-screen bg-[#08090f] text-slate-100 font-sans selection:bg-pink-500 selection:text-white">
      {/* ── Top Navbar ────────────────────────────────────────── */}
      <header className="fixed top-0 left-0 right-0 z-50 h-16 px-6 bg-[#08090f]/80 backdrop-blur-xl border-b border-slate-800/80 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 text-decoration-none">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-pink-500 to-purple-600 flex items-center justify-center shadow-lg shadow-pink-500/25">
            <Bot className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-lg text-white tracking-tight">Plexo <span className="text-pink-400 font-mono text-xs px-1.5 py-0.5 rounded bg-pink-500/10 border border-pink-500/20">MCP</span></span>
        </Link>

        <div className="flex items-center gap-4">
          <Link
            href="/dashboard/integrations"
            className="text-xs text-slate-300 hover:text-white transition font-medium hidden sm:inline-block"
          >
            Integration Hub
          </Link>
          <Link
            href="/login"
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white text-xs font-semibold shadow-md shadow-pink-500/20 transition"
          >
            Get Started
          </Link>
        </div>
      </header>

      <main className="pt-24 pb-20 px-4 md:px-8 max-w-7xl mx-auto space-y-24">
        {/* ── HERO SECTION ───────────────────────────────────── */}
        <section className="text-center max-w-4xl mx-auto space-y-6 pt-8">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-pink-500/10 border border-pink-500/25 text-pink-300 text-xs font-medium backdrop-blur-md">
            <Sparkles className="w-3.5 h-3.5 text-pink-400" />
            Official Model Context Protocol & Custom Actions
          </div>

          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight text-white leading-tight">
            Prompt Any AI to <span className="bg-gradient-to-r from-pink-400 via-purple-400 to-indigo-400 bg-clip-text text-transparent">Generate & Publish</span> Plexo Pages
          </h1>

          <p className="text-base md:text-lg text-slate-400 max-w-2xl mx-auto leading-relaxed">
            Connect <strong className="text-slate-200">Claude</strong>, <strong className="text-slate-200">ChatGPT</strong>, <strong className="text-slate-200">Cursor</strong>, and <strong className="text-slate-200">Gemini</strong> to Plexo. Create landing pages in JSON & HTML, publish to custom domains, and inspect analytics directly from AI chat.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
            <Link
              href="/dashboard/integrations"
              className="px-6 py-3.5 rounded-2xl bg-gradient-to-r from-pink-500 via-purple-600 to-indigo-600 hover:opacity-95 text-white text-sm font-bold shadow-xl shadow-pink-500/25 flex items-center gap-2 transition"
            >
              Connect Your AI Assistant
              <ArrowRight className="w-4 h-4" />
            </Link>

            <a
              href="#use-cases"
              className="px-6 py-3.5 rounded-2xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 text-sm font-semibold transition"
            >
              Explore Use Cases
            </a>
          </div>
        </section>

        {/* ── INTERACTIVE PROMPT DEMO ───────────────────────────── */}
        <section className="bg-[#111625]/90 border border-slate-800 rounded-3xl p-6 md:p-8 shadow-2xl backdrop-blur-2xl space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Terminal className="w-5 h-5 text-pink-400" />
                Live MCP Prompt Simulation
              </h2>
              <p className="text-xs text-slate-400">Click a scenario to see how Plexo MCP handles AI user prompts behind the scenes.</p>
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
                        ? "bg-pink-500 text-white shadow-md shadow-pink-500/20"
                        : "bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* User Input Bubble */}
            <div className="space-y-3">
              <span className="text-xs font-mono text-slate-400 uppercase tracking-wider block">USER PROMPT (Claude / ChatGPT)</span>
              <div className="p-4 rounded-2xl bg-[#090d16] border border-slate-800 text-sm text-pink-200 font-sans leading-relaxed shadow-inner">
                "{currentSample.userPrompt}"
              </div>
            </div>

            {/* AI Result Execution */}
            <div className="space-y-3">
              <span className="text-xs font-mono text-slate-400 uppercase tracking-wider block flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                MCP RESPONSE & ACTION
              </span>
              <div className="p-4 rounded-2xl bg-[#090d16] border border-slate-800 text-xs font-mono text-emerald-300 space-y-2 overflow-x-auto shadow-inner">
                <pre>{JSON.stringify(currentSample.aiResult, null, 2)}</pre>
              </div>
            </div>
          </div>
        </section>

        {/* ── CORE USE CASES ───────────────────────────────────── */}
        <section id="use-cases" className="space-y-12">
          <div className="text-center max-w-2xl mx-auto space-y-3">
            <h2 className="text-3xl font-bold text-white tracking-tight">4 Powerful Use Cases for AI Teams</h2>
            <p className="text-sm text-slate-400">
              Transform simple natural language prompts into complete landing pages, analytics summaries, and campaign workflows.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Case 1 */}
            <div className="bg-[#111625]/80 border border-slate-800 rounded-3xl p-8 space-y-4 hover:border-pink-500/40 transition">
              <div className="w-12 h-12 rounded-2xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-400">
                <Globe className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white">1. Prompt to Published Domain</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Prompt the AI to construct a page for your brand. The MCP server generates the structured <code className="text-pink-300">designJson</code> layout (for visual drag-and-drop editing in Plexo) and auto-compiles production HTML, publishing it immediately to your subdomain or custom domain.
              </p>
            </div>

            {/* Case 2 */}
            <div className="bg-[#111625]/80 border border-slate-800 rounded-3xl p-8 space-y-4 hover:border-purple-500/40 transition">
              <div className="w-12 h-12 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                <BarChart3 className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white">2. Conversational Visitor Analytics</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Ask your AI: <em className="text-purple-300">"Which of my landing pages had the highest visitor conversion this week?"</em> The MCP server queries page view aggregates, unique visitor IPs, and performance metrics directly.
              </p>
            </div>

            {/* Case 3 */}
            <div className="bg-[#111625]/80 border border-slate-800 rounded-3xl p-8 space-y-4 hover:border-indigo-500/40 transition">
              <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                <Layers className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white">3. Email & Landing Page Inventory</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Inspect all saved email templates, newsletters, and draft pages in your account. Your AI assistant can clone, update, or reference existing designs during prompt conversations.
              </p>
            </div>

            {/* Case 4 */}
            <div className="bg-[#111625]/80 border border-slate-800 rounded-3xl p-8 space-y-4 hover:border-emerald-500/40 transition">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                <Lock className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white">4. Browser Sign-In Authentication</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Never type sensitive API keys directly into public chat windows. The Plexo MCP server uses a secure browser authorization flow (<code className="text-emerald-300">/mcp/login</code>) to grant tokens safely.
              </p>
            </div>
          </div>
        </section>

        {/* ── PLATFORM SETUP GUIDES ──────────────────────────────── */}
        <section className="bg-[#111625]/80 border border-slate-800 rounded-3xl p-8 space-y-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-white">Supported AI Platforms</h2>
              <p className="text-xs text-slate-400">Connect in less than 60 seconds across all major AI tools.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Claude */}
            <div className="p-6 rounded-2xl bg-[#090d16] border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-white flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-orange-400" />
                  Claude (Web & Desktop)
                </span>
                <span className="text-[10px] font-mono text-orange-400 bg-orange-500/10 border border-orange-500/20 px-2 py-0.5 rounded">
                  MCP
                </span>
              </div>
              <p className="text-xs text-slate-400">Add <code className="text-slate-200">@plexo/mcp</code> to your <code className="text-slate-200">claude_desktop_config.json</code> or load the SKILL.md guide.</p>
            </div>

            {/* ChatGPT */}
            <div className="p-6 rounded-2xl bg-[#090d16] border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-white flex items-center gap-2">
                  <Bot className="w-4 h-4 text-emerald-400" />
                  ChatGPT Custom Action
                </span>
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">
                  OpenAPI 3.1
                </span>
              </div>
              <p className="text-xs text-slate-400">Import <code className="text-slate-200">{baseUrl}/openapi.json</code> in ChatGPT GPT Builder Editor.</p>
            </div>

            {/* Cursor */}
            <div className="p-6 rounded-2xl bg-[#090d16] border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-white flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-cyan-400" />
                  Cursor / Windsurf IDE
                </span>
                <span className="text-[10px] font-mono text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded">
                  .cursor/mcp.json
                </span>
              </div>
              <p className="text-xs text-slate-400">Add <code className="text-slate-200">npx @plexo/mcp</code> command server to workspace config.</p>
            </div>
          </div>
        </section>

        {/* ── FOOTER CTA ────────────────────────────────────────── */}
        <section className="text-center py-12 space-y-6 bg-gradient-to-tr from-pink-500/10 via-purple-500/10 to-indigo-500/10 border border-slate-800 rounded-3xl p-8">
          <h2 className="text-3xl font-extrabold text-white">Ready to Power Your AI Workflows with Plexo?</h2>
          <p className="text-sm text-slate-300 max-w-xl mx-auto">
            Get instant access to AI page generation, visual drag-and-drop customization, and custom domain publishing.
          </p>

          <div className="pt-2">
            <Link
              href="/dashboard/integrations"
              className="inline-flex items-center gap-2 px-8 py-3.5 rounded-2xl bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white font-bold text-sm shadow-xl shadow-pink-500/25 transition"
            >
              Open Integration Hub
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
