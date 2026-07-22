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
  Code2,
  Lock,
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
    <div className="max-w-[1500px] mx-auto p-6 md:p-8 space-y-8 font-sans">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-white/10">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#8b5cf6] to-[#7c3aed] flex items-center justify-center shadow-lg shadow-[#8b5cf6]/25">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
                AI & MCP Skill Hub
                <Sparkles className="w-4 h-4 text-[#a78bfa]" />
              </h1>
              <p className="text-sm text-white/60">
                Connect Claude, ChatGPT, Cursor, and Gemini to generate & publish Plexo landing pages seamlessly.
              </p>
            </div>
          </div>
        </div>

        <a
          href="/mcp/login"
          target="_blank"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#8b5cf6]/10 border border-[#8b5cf6]/25 text-[#a78bfa] hover:bg-[#8b5cf6]/20 text-xs font-semibold transition"
        >
          <Lock className="w-4 h-4" />
          Authenticate Session Token
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* Grid of AI Integrations */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Card 1: Claude (Desktop & Web) */}
        <div className="bg-[#111827]/80 border border-white/10 rounded-2xl p-6 flex flex-col justify-between hover:border-white/20 transition">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-[#8b5cf6]/10 border border-[#8b5cf6]/20 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-[#8b5cf6]" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">Claude (Web & Desktop)</h3>
                  <p className="text-xs text-white/50">MCP Server & Skill Bundle</p>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-1 rounded bg-[#8b5cf6]/10 text-[#a78bfa] border border-[#8b5cf6]/20">
                MCP Standard
              </span>
            </div>

            <p className="text-xs text-white/70 mb-4 leading-relaxed">
              Install the official Plexo MCP server into Claude Desktop or load the Skill spec into Claude Web.
            </p>

            <div className="space-y-3">
              <label className="text-xs font-mono text-white/50 block">
                Claude Desktop Configuration (<code className="text-[#a78bfa]">claude_desktop_config.json</code>):
              </label>
              <div className="relative">
                <pre className="p-3 bg-[#090d16] border border-white/10 rounded-xl text-xs font-mono text-white/80 overflow-x-auto">
                  {claudeDesktopConfig}
                </pre>
                <button
                  onClick={() => handleCopy(claudeDesktopConfig, "claude")}
                  className="absolute top-2 right-2 p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 transition"
                >
                  {copiedKey === "claude" ? (
                    <Check className="w-3.5 h-3.5 text-[#34d399]" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-white/10 flex items-center justify-between">
            <a
              href="/skills/SKILL.md"
              target="_blank"
              className="text-xs text-[#a78bfa] hover:text-white font-medium flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              Download SKILL.md for Claude Web
            </a>
          </div>
        </div>

        {/* Card 2: ChatGPT (GPTs & Custom Actions) */}
        <div className="bg-[#111827]/80 border border-white/10 rounded-2xl p-6 flex flex-col justify-between hover:border-white/20 transition">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-[#34d399]/10 border border-[#34d399]/20 flex items-center justify-center">
                  <Bot className="w-5 h-5 text-[#34d399]" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">ChatGPT (Custom GPT)</h3>
                  <p className="text-xs text-white/50">OpenAPI 3.1 Custom Action</p>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-1 rounded bg-[#34d399]/10 text-[#34d399] border border-[#34d399]/20">
                OpenAPI Spec
              </span>
            </div>

            <p className="text-xs text-white/70 mb-4 leading-relaxed">
              Import our OpenAPI specification directly into ChatGPT Custom GPT Builder to enable 1-click landing page creation.
            </p>

            <div className="space-y-3">
              <label className="text-xs font-mono text-white/50 block">OpenAPI Import URL:</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={`${baseUrl}/openapi.json`}
                  className="w-full p-2.5 bg-[#090d16] border border-white/10 rounded-xl text-xs font-mono text-white/80 select-all"
                />
                <button
                  onClick={() => handleCopy(`${baseUrl}/openapi.json`, "openapi")}
                  className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white/80 transition shrink-0"
                >
                  {copiedKey === "openapi" ? (
                    <Check className="w-4 h-4 text-[#34d399]" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-white/10 flex items-center justify-between">
            <a
              href="https://chatgpt.com/gpts/editor"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-[#34d399] hover:text-[#34d399]/80 font-medium flex items-center gap-1.5"
            >
              Open GPT Builder in ChatGPT
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>

        {/* Card 3: Cursor / Windsurf / VS Code */}
        <div className="bg-[#111827]/80 border border-white/10 rounded-2xl p-6 flex flex-col justify-between hover:border-white/20 transition">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-[#818cf8]/10 border border-[#818cf8]/20 flex items-center justify-center">
                  <Terminal className="w-5 h-5 text-[#818cf8]" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">Cursor & Windsurf IDE</h3>
                  <p className="text-xs text-white/50">MCP Configuration File</p>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-1 rounded bg-[#818cf8]/10 text-[#818cf8] border border-[#818cf8]/20">
                .cursor/mcp.json
              </span>
            </div>

            <p className="text-xs text-white/70 mb-4 leading-relaxed">
              Add the Plexo MCP server to your workspace configuration in Cursor or Windsurf to prompt AI agents locally.
            </p>

            <div className="space-y-3">
              <div className="relative">
                <pre className="p-3 bg-[#090d16] border border-white/10 rounded-xl text-xs font-mono text-white/80 overflow-x-auto">
                  {cursorMcpConfig}
                </pre>
                <button
                  onClick={() => handleCopy(cursorMcpConfig, "cursor")}
                  className="absolute top-2 right-2 p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 transition"
                >
                  {copiedKey === "cursor" ? (
                    <Check className="w-3.5 h-3.5 text-[#34d399]" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Card 4: Dedicated MCP Package Repo */}
        <div className="bg-[#111827]/80 border border-white/10 rounded-2xl p-6 flex flex-col justify-between hover:border-white/20 transition">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                  <Code2 className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">Standalone MCP Repository</h3>
                  <p className="text-xs text-white/50">@charisol/plexo-mcp NPM Package</p>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-1 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                NPM / Open Source
              </span>
            </div>

            <p className="text-xs text-white/70 mb-4 leading-relaxed">
              Our standalone MCP server package runs locally or on remote servers with standard <code className="text-[#a78bfa]">stdio</code> and <code className="text-[#a78bfa]">HTTP/SSE</code> transports.
            </p>

            <div className="p-3 bg-[#090d16] border border-white/10 rounded-xl text-xs font-mono text-[#a78bfa]">
              $ npx -y @charisol/plexo-mcp
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-white/10 flex items-center justify-between">
            <span className="text-xs text-white/50">Exposes 6 core tools: landing pages, templates, analytics & profile</span>
          </div>
        </div>
      </div>
    </div>
  );
}
