"use client";

import React, { useState } from "react";
import {
  Bot,
  Sparkles,
  Copy,
  Check,
  Download,
  ExternalLink,
  Terminal,
  Zap,
  Code2,
  Lock,
  Layers,
  Globe,
  HelpCircle,
} from "lucide-react";

type IntegrationClientProps = {
  user: {
    name: string;
    email: string;
  };
  apiKeys: Array<{
    id: string;
    name: string;
    maskedKey: string;
    createdAt: Date;
  }>;
  baseUrl: string;
};

export default function IntegrationsClient({ user, apiKeys, baseUrl }: IntegrationClientProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const activeKeyDisplay = apiKeys[0]?.maskedKey || "plexo_sk_your_api_key_here";

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const cursorMcpConfig = JSON.stringify(
    {
      mcpServers: {
        plexo: {
          command: "npx",
          args: ["-y", "@charisol/plexo-mcp"],
          env: {
            PLEXO_API_KEY: activeKeyDisplay,
            PLEXO_BASE_URL: baseUrl,
          },
        },
      },
    },
    null,
    2
  );

  const claudeDesktopConfig = JSON.stringify(
    {
      mcpServers: {
        plexo: {
          command: "npx",
          args: ["-y", "@charisol/plexo-mcp"],
          env: {
            PLEXO_API_KEY: activeKeyDisplay,
          },
        },
      },
    },
    null,
    2
  );

  return (
    <div className="max-w-6xl mx-auto p-6 md:p-8 space-y-8 font-sans">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-pink-500 to-rose-500 flex items-center justify-center shadow-lg shadow-pink-500/20">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
                AI & MCP Skill Hub
                <Sparkles className="w-4 h-4 text-pink-400" />
              </h1>
              <p className="text-sm text-slate-400">
                Connect Claude, ChatGPT, Cursor, and Gemini to generate & publish Plexo landing pages seamlessly.
              </p>
            </div>
          </div>
        </div>

        <a
          href="/mcp/login"
          target="_blank"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-pink-500/10 border border-pink-500/30 text-pink-300 hover:bg-pink-500/20 text-sm font-medium transition"
        >
          <Lock className="w-4 h-4" />
          Authenticate Session Token
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* Grid of AI Integrations */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Card 1: Claude (Desktop & Web) */}
        <div className="bg-[#111827]/80 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between hover:border-slate-700 transition">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-orange-400" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">Claude (Web & Desktop)</h3>
                  <p className="text-xs text-slate-400">MCP Server & Skill Bundle</p>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-1 rounded bg-orange-500/10 text-orange-400 border border-orange-500/20">
                MCP Standard
              </span>
            </div>

            <p className="text-xs text-slate-300 mb-4 leading-relaxed">
              Install the official Plexo MCP server into Claude Desktop or load the Skill spec into Claude Web.
            </p>

            <div className="space-y-3">
              <label className="text-xs font-mono text-slate-400 block">
                Claude Desktop Configuration (<code className="text-pink-300">claude_desktop_config.json</code>):
              </label>
              <div className="relative">
                <pre className="p-3 bg-[#090d16] border border-slate-800 rounded-xl text-xs font-mono text-slate-300 overflow-x-auto">
                  {claudeDesktopConfig}
                </pre>
                <button
                  onClick={() => handleCopy(claudeDesktopConfig, "claude")}
                  className="absolute top-2 right-2 p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                >
                  {copiedKey === "claude" ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-800/80 flex items-center justify-between">
            <a
              href="/skills/SKILL.md"
              target="_blank"
              className="text-xs text-pink-400 hover:text-pink-300 font-medium flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              Download SKILL.md for Claude Web
            </a>
          </div>
        </div>

        {/* Card 2: ChatGPT (GPTs & Custom Actions) */}
        <div className="bg-[#111827]/80 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between hover:border-slate-700 transition">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                  <Bot className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">ChatGPT (Custom GPT)</h3>
                  <p className="text-xs text-slate-400">OpenAPI 3.1 Custom Action</p>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                OpenAPI Spec
              </span>
            </div>

            <p className="text-xs text-slate-300 mb-4 leading-relaxed">
              Import our OpenAPI specification directly into ChatGPT Custom GPT Builder to enable 1-click landing page creation.
            </p>

            <div className="space-y-3">
              <label className="text-xs font-mono text-slate-400 block">OpenAPI Import URL:</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={`${baseUrl}/openapi.json`}
                  className="w-full p-2.5 bg-[#090d16] border border-slate-800 rounded-xl text-xs font-mono text-slate-300 select-all"
                />
                <button
                  onClick={() => handleCopy(`${baseUrl}/openapi.json`, "openapi")}
                  className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition shrink-0"
                >
                  {copiedKey === "openapi" ? (
                    <Check className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-800/80 flex items-center justify-between">
            <a
              href="https://chatgpt.com/gpts/editor"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-emerald-400 hover:text-emerald-300 font-medium flex items-center gap-1.5"
            >
              Open GPT Builder in ChatGPT
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>

        {/* Card 3: Cursor / Windsurf / VS Code */}
        <div className="bg-[#111827]/80 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between hover:border-slate-700 transition">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                  <Terminal className="w-5 h-5 text-cyan-400" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">Cursor & Windsurf IDE</h3>
                  <p className="text-xs text-slate-400">MCP Configuration File</p>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-1 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                .cursor/mcp.json
              </span>
            </div>

            <p className="text-xs text-slate-300 mb-4 leading-relaxed">
              Add the Plexo MCP server to your workspace configuration in Cursor or Windsurf to prompt AI agents locally.
            </p>

            <div className="space-y-3">
              <div className="relative">
                <pre className="p-3 bg-[#090d16] border border-slate-800 rounded-xl text-xs font-mono text-slate-300 overflow-x-auto">
                  {cursorMcpConfig}
                </pre>
                <button
                  onClick={() => handleCopy(cursorMcpConfig, "cursor")}
                  className="absolute top-2 right-2 p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                >
                  {copiedKey === "cursor" ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Card 4: Dedicated MCP Package Repo */}
        <div className="bg-[#111827]/80 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between hover:border-slate-700 transition">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                  <Code2 className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">Standalone MCP Repository</h3>
                  <p className="text-xs text-slate-400">@plexo/mcp Node.js Package</p>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-1 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                NPM / Open Source
              </span>
            </div>

            <p className="text-xs text-slate-300 mb-4 leading-relaxed">
              Our standalone MCP server package runs locally or on remote servers with standard <code className="text-pink-300">stdio</code> and <code className="text-pink-300">HTTP/SSE</code> transports.
            </p>

            <div className="p-3 bg-[#090d16] border border-slate-800 rounded-xl text-xs font-mono text-purple-300">
              $ npx -y @plexo/mcp
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-800/80 flex items-center justify-between">
            <span className="text-xs text-slate-400">Exposes 7+ tools: landing pages, templates, analytics & profile</span>
          </div>
        </div>
      </div>
    </div>
  );
}
