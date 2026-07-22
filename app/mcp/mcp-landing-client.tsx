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

  return (
    <div className="min-h-screen bg-[#08090f] text-[#f0f2ff] font-sans selection:bg-[#8b5cf6] selection:text-white">
      {/* ── Top Navbar ────────────────────────────────────────── */}
      <header className="fixed top-0 left-0 right-0 z-50 h-16 px-6 bg-[#08090f]/90 backdrop-blur-xl border-b border-white/[0.08] flex items-center justify-between">
        <div className="max-w-[1500px] w-full mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 text-decoration-none">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-[#8b5cf6] to-[#7c3aed] flex items-center justify-center shadow-lg shadow-[#8b5cf6]/30">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-lg text-white tracking-tight">
              Plexo <span className="text-[#a78bfa] font-mono text-xs px-1.5 py-0.5 rounded bg-[#8b5cf6]/10 border border-[#8b5cf6]/20">MCP</span>
            </span>
          </Link>

          <div className="flex items-center gap-4">
            <Link
              href="/dashboard/integrations"
              className="text-xs text-white/70 hover:text-white transition font-medium hidden sm:inline-block"
            >
              Integration Hub
            </Link>
            <Link
              href="/login"
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#8b5cf6] to-[#7c3aed] hover:from-[#7c3aed] hover:to-[#6d28d9] text-white text-xs font-semibold shadow-md shadow-[#8b5cf6]/25 transition"
            >
              Get Started
            </Link>
          </div>
        </div>
      </header>

      {/* ── Main Container (Enforcing 1500px limit) ──────────────────── */}
      <main className="pt-24 pb-20 px-4 md:px-6 max-w-[1500px] mx-auto space-y-16">
        {/* ── HERO SECTION ───────────────────────────────────── */}
        <section className="text-center max-w-3xl mx-auto space-y-6 pt-6">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#8b5cf6]/10 border border-[#8b5cf6]/20 text-[#a78bfa] text-xs font-medium backdrop-blur-md">
            <Sparkles className="w-3.5 h-3.5 text-[#8b5cf6]" />
            Model Context Protocol & Custom Actions
          </div>

          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-white leading-tight">
            Prompt Any AI to <span className="bg-gradient-to-r from-[#a78bfa] via-[#818cf8] to-[#34d399] bg-clip-text text-transparent">Generate & Publish</span> Plexo Pages
          </h1>

          <p className="text-sm md:text-base text-[#f0f2ff]/70 max-w-2xl mx-auto leading-relaxed">
            Connect <strong className="text-white">Claude</strong>, <strong className="text-white">ChatGPT</strong>, <strong className="text-white">Cursor</strong>, and <strong className="text-white">Gemini</strong> to Plexo. Create landing pages in JSON & HTML, publish to custom domains, and inspect analytics directly from AI chat.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
            <Link
              href="/dashboard/integrations"
              className="px-6 py-3.5 rounded-2xl bg-gradient-to-r from-[#8b5cf6] to-[#7c3aed] hover:opacity-95 text-white text-sm font-bold shadow-xl shadow-[#8b5cf6]/25 flex items-center gap-2 transition"
            >
              Connect Your AI Assistant
              <ArrowRight className="w-4 h-4" />
            </Link>

            <a
              href="#use-cases"
              className="px-6 py-3.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-white/90 text-sm font-semibold transition"
            >
              Explore Use Cases
            </a>
          </div>
        </section>

        {/* ── INTERACTIVE PROMPT DEMO ───────────────────────────── */}
        <section className="bg-[#111827]/90 border border-white/10 rounded-3xl p-6 md:p-8 shadow-2xl backdrop-blur-xl space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-5">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Terminal className="w-5 h-5 text-[#8b5cf6]" />
                Live MCP Prompt Simulation
              </h2>
              <p className="text-xs text-white/50">Click a scenario to see how Plexo MCP handles AI prompts behind the scenes.</p>
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
                        ? "bg-[#8b5cf6] text-white shadow-md shadow-[#8b5cf6]/30"
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* User Input Bubble */}
            <div className="space-y-2">
              <span className="text-[11px] font-mono text-white/40 uppercase tracking-wider block">USER PROMPT (Claude / ChatGPT)</span>
              <div className="p-4 rounded-2xl bg-[#090d16] border border-white/10 text-xs text-[#a78bfa] font-sans leading-relaxed shadow-inner">
                "{currentSample.userPrompt}"
              </div>
            </div>

            {/* AI Result Execution */}
            <div className="space-y-2">
              <span className="text-[11px] font-mono text-white/40 uppercase tracking-wider block flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-[#34d399]" />
                MCP RESPONSE & ACTION
              </span>
              <div className="p-4 rounded-2xl bg-[#090d16] border border-white/10 text-xs font-mono text-[#34d399] space-y-2 overflow-x-auto shadow-inner">
                <pre>{JSON.stringify(currentSample.aiResult, null, 2)}</pre>
              </div>
            </div>
          </div>
        </section>

        {/* ── CORE USE CASES ───────────────────────────────────── */}
        <section id="use-cases" className="space-y-8">
          <div className="text-center max-w-2xl mx-auto space-y-2">
            <h2 className="text-2xl font-bold text-white tracking-tight">4 Core Abilities for AI Workflows</h2>
            <p className="text-xs text-white/60">
              Transform natural language prompts into complete landing pages, analytics queries, and campaign templates.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Case 1 */}
            <div className="bg-[#111827]/80 border border-white/10 rounded-2xl p-6 space-y-3 hover:border-[#8b5cf6]/40 transition">
              <div className="w-10 h-10 rounded-xl bg-[#8b5cf6]/10 border border-[#8b5cf6]/20 flex items-center justify-center text-[#8b5cf6]">
                <Globe className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-white">1. Prompt to Published Domain</h3>
              <p className="text-xs text-white/70 leading-relaxed">
                Prompt the AI to construct a page for your brand. The MCP server generates the structured <code className="text-[#a78bfa]">designJson</code> layout (for visual drag-and-drop editing in Plexo) and auto-compiles production HTML, publishing it immediately to your subdomain or custom domain.
              </p>
            </div>

            {/* Case 2 */}
            <div className="bg-[#111827]/80 border border-white/10 rounded-2xl p-6 space-y-3 hover:border-[#818cf8]/40 transition">
              <div className="w-10 h-10 rounded-xl bg-[#818cf8]/10 border border-[#818cf8]/20 flex items-center justify-center text-[#818cf8]">
                <BarChart3 className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-white">2. Conversational Visitor Analytics</h3>
              <p className="text-xs text-white/70 leading-relaxed">
                Ask your AI: <em className="text-[#818cf8]">"Which of my landing pages had the highest visitor conversion this week?"</em> The MCP server queries page view aggregates, unique visitor IPs, and performance metrics directly.
              </p>
            </div>

            {/* Case 3 */}
            <div className="bg-[#111827]/80 border border-white/10 rounded-2xl p-6 space-y-3 hover:border-[#34d399]/40 transition">
              <div className="w-10 h-10 rounded-xl bg-[#34d399]/10 border border-[#34d399]/20 flex items-center justify-center text-[#34d399]">
                <Layers className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-white">3. Email & Landing Page Inventory</h3>
              <p className="text-xs text-white/70 leading-relaxed">
                Inspect all saved email templates, newsletters, and draft pages in your account. Your AI assistant can clone, update, or reference existing designs during prompt conversations.
              </p>
            </div>

            {/* Case 4 */}
            <div className="bg-[#111827]/80 border border-white/10 rounded-2xl p-6 space-y-3 hover:border-[#a78bfa]/40 transition">
              <div className="w-10 h-10 rounded-xl bg-[#a78bfa]/10 border border-[#a78bfa]/20 flex items-center justify-center text-[#a78bfa]">
                <Lock className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-white">4. Browser Sign-In Authentication</h3>
              <p className="text-xs text-white/70 leading-relaxed">
                Never type sensitive API keys directly into public chat windows. The Plexo MCP server uses a secure browser authorization flow (<code className="text-[#34d399]">/mcp/login</code>) to grant tokens safely.
              </p>
            </div>
          </div>
        </section>

        {/* ── PLATFORM SETUP GUIDES ──────────────────────────────── */}
        <section className="bg-[#111827]/80 border border-white/10 rounded-3xl p-6 md:p-8 space-y-6">
          <div>
            <h2 className="text-xl font-bold text-white">Supported AI Platforms</h2>
            <p className="text-xs text-white/60">Connect in less than 60 seconds across all major AI tools.</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Claude */}
            <div className="p-5 rounded-2xl bg-[#090d16] border border-white/10 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#8b5cf6]" />
                  Claude (Web & Desktop)
                </span>
                <span className="text-[10px] font-mono text-[#a78bfa] bg-[#8b5cf6]/10 border border-[#8b5cf6]/20 px-2 py-0.5 rounded">
                  MCP
                </span>
              </div>
              <p className="text-xs text-white/60">Add <code className="text-white/80">@charisol/plexo-mcp</code> to your <code className="text-white/80">claude_desktop_config.json</code> or load SKILL.md.</p>
            </div>

            {/* ChatGPT */}
            <div className="p-5 rounded-2xl bg-[#090d16] border border-white/10 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white flex items-center gap-2">
                  <Bot className="w-4 h-4 text-[#34d399]" />
                  ChatGPT Custom Action
                </span>
                <span className="text-[10px] font-mono text-[#34d399] bg-[#34d399]/10 border border-[#34d399]/20 px-2 py-0.5 rounded">
                  OpenAPI 3.1
                </span>
              </div>
              <p className="text-xs text-white/60">Import <code className="text-white/80">{baseUrl}/openapi.json</code> in ChatGPT GPT Builder Editor.</p>
            </div>

            {/* Cursor */}
            <div className="p-5 rounded-2xl bg-[#090d16] border border-white/10 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-[#818cf8]" />
                  Cursor / Windsurf IDE
                </span>
                <span className="text-[10px] font-mono text-[#818cf8] bg-[#818cf8]/10 border border-[#818cf8]/20 px-2 py-0.5 rounded">
                  .cursor/mcp.json
                </span>
              </div>
              <p className="text-xs text-white/60">Add <code className="text-white/80">npx @charisol/plexo-mcp</code> command server to workspace config.</p>
            </div>
          </div>
        </section>

        {/* ── FOOTER CTA ────────────────────────────────────────── */}
        <section className="text-center py-10 space-y-5 bg-gradient-to-tr from-[#8b5cf6]/10 via-[#7c3aed]/10 to-[#34d399]/10 border border-white/10 rounded-3xl p-6">
          <h2 className="text-2xl font-bold text-white">Ready to Power Your AI Workflows with Plexo?</h2>
          <p className="text-xs text-white/70 max-w-xl mx-auto">
            Get instant access to AI page generation, visual drag-and-drop customization, and custom domain publishing.
          </p>

          <div className="pt-2">
            <Link
              href="/dashboard/integrations"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-[#8b5cf6] to-[#7c3aed] hover:from-[#7c3aed] hover:to-[#6d28d9] text-white font-bold text-xs shadow-lg shadow-[#8b5cf6]/25 transition"
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
