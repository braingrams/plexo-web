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
  Globe,
  Layers,
  Sliders,
  ShieldCheck,
  ChevronRight,
  Info,
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
  const [activeTab, setActiveTab] = useState<"claude" | "chatgpt" | "cursor" | "gpts">("claude");

  const activeKeyDisplay = apiKeys[0]?.maskedKey || "plexo_sk_your_api_key_here";

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const serverMcpUrl = `${baseUrl}/api/v1/mcp`;
  const authorizeUrl = `${baseUrl}/api/v1/auth/oauth/authorize`;
  const tokenUrl = `${baseUrl}/api/v1/auth/oauth/token`;

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

  return (
    <div className="max-w-[1500px] mx-auto p-6 md:p-8 space-y-8 font-sans text-[#f0f2ff]">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-white/10">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#8b5cf6] to-[#7c3aed] flex items-center justify-center shadow-lg shadow-[#8b5cf6]/25">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
                AI & MCP Integration Hub
                <Sparkles className="w-4 h-4 text-[#a78bfa]" />
              </h1>
              <p className="text-sm text-white/60">
                Connect Claude, ChatGPT, Cursor, and Gemini to generate, compile, and publish landing pages directly from chat.
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

      {/* ── Tabs Selector ─────────────────────────────────────── */}
      <div className="flex items-center gap-2 border-b border-white/10 pb-4 overflow-x-auto">
        {[
          { id: "claude", label: "Claude Custom Connectors", icon: Sparkles },
          { id: "chatgpt", label: "ChatGPT Developer Plugin / Remote MCP", icon: Bot },
          { id: "cursor", label: "Cursor & Windsurf IDE", icon: Terminal },
          { id: "gpts", label: "ChatGPT Custom GPT Action", icon: Globe },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition whitespace-nowrap ${
                active
                  ? "bg-[#8b5cf6] text-white shadow-lg shadow-[#8b5cf6]/25"
                  : "bg-white/[0.04] text-white/60 hover:text-white border border-white/10"
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── Active Tab Details ─────────────────────────────────── */}
      {activeTab === "claude" && (
        <div className="bg-[#111827]/80 border border-white/10 rounded-3xl p-6 md:p-8 space-y-6 shadow-xl">
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#8b5cf6]/10 border border-[#8b5cf6]/20 flex items-center justify-center text-[#8b5cf6]">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Claude Web Custom Connector Setup</h2>
                <p className="text-xs text-white/60">Connect Plexo in Claude Web under <code className="text-[#a78bfa]">Customize → Connectors</code>.</p>
              </div>
            </div>
            <span className="text-xs font-mono px-2.5 py-1 rounded-lg bg-[#8b5cf6]/10 text-[#a78bfa] border border-[#8b5cf6]/20">
              Remote MCP
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Sliders className="w-4 h-4 text-[#8b5cf6]" />
                Step-by-Step Instructions
              </h3>
              <ol className="space-y-3 text-xs text-white/70 list-decimal list-inside leading-relaxed">
                <li>In Claude's left sidebar, click <strong className="text-white">Customize → Connectors</strong> (located right above Plugins).</li>
                <li>Click the <strong className="text-white">Add ∨</strong> dropdown at top right and select <strong className="text-white">Add custom connector</strong>.</li>
                <li>Fill in the connector values shown on the right.</li>
                <li>Click <strong className="text-white">Add</strong> and complete the popup authorization.</li>
              </ol>

              <div className="p-4 rounded-2xl bg-[#090d16] border border-white/10 space-y-2">
                <span className="text-[11px] font-semibold text-[#a78bfa] block flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5" />
                  How to Use in Claude Chat
                </span>
                <p className="text-xs text-white/60 leading-relaxed">
                  Open a new chat, click the <strong className="text-white">+</strong> icon at bottom left of prompt box, select <strong className="text-white">Connectors</strong>, and check <strong className="text-white">Plexo</strong>.
                </p>
              </div>
            </div>

            <div className="space-y-4 bg-[#090d16] border border-white/10 p-5 rounded-2xl">
              <h3 className="text-xs font-mono text-white/40 uppercase tracking-wider">Connector Field Values</h3>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="text-white/60 block mb-1">Connector Name:</label>
                  <div className="p-2.5 bg-white/[0.04] border border-white/10 rounded-xl font-mono text-white select-all">
                    Plexo
                  </div>
                </div>

                <div>
                  <label className="text-white/60 block mb-1">Remote MCP Server URL:</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={serverMcpUrl}
                      className="w-full p-2.5 bg-white/[0.04] border border-white/10 rounded-xl font-mono text-[#a78bfa] select-all"
                    />
                    <button
                      onClick={() => handleCopy(serverMcpUrl, "claude-url")}
                      className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition shrink-0"
                    >
                      {copiedKey === "claude-url" ? <Check className="w-4 h-4 text-[#34d399]" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-white/60 block mb-1">OAuth Client ID (Optional / Advanced):</label>
                  <div className="p-2.5 bg-white/[0.04] border border-white/10 rounded-xl font-mono text-white/80">
                    plexo_mcp_client
                  </div>
                </div>

                <div>
                  <label className="text-white/60 block mb-1">OAuth Client Secret (Optional / Advanced):</label>
                  <div className="p-2.5 bg-white/[0.04] border border-white/10 rounded-xl font-mono text-white/80">
                    plexo_mcp_secret
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "chatgpt" && (
        <div className="bg-[#111827]/80 border border-white/10 rounded-3xl p-6 md:p-8 space-y-6 shadow-xl">
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#34d399]/10 border border-[#34d399]/20 flex items-center justify-center text-[#34d399]">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">ChatGPT Developer Plugin & Remote MCP Setup</h2>
                <p className="text-xs text-white/60">Connect Plexo under <code className="text-[#34d399]">Settings → Plugins → New Plugin</code>.</p>
              </div>
            </div>
            <span className="text-xs font-mono px-2.5 py-1 rounded-lg bg-[#34d399]/10 text-[#34d399] border border-[#34d399]/20">
              Developer Mode
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Sliders className="w-4 h-4 text-[#34d399]" />
                Step-by-Step Instructions
              </h3>
              <ol className="space-y-3 text-xs text-white/70 list-decimal list-inside leading-relaxed">
                <li>Toggle ON <strong className="text-white">Developer mode</strong> in ChatGPT under <strong className="text-white">Settings → Security and login</strong>.</li>
                <li>Go to <strong className="text-white">Settings → Plugins</strong> (or <a href="https://chatgpt.com/plugins" target="_blank" className="text-[#34d399] underline">chatgpt.com/plugins</a>).</li>
                <li>Click the <strong className="text-white">+ (New Plugin)</strong> button and select <strong className="text-white">Developer-mode app / Remote MCP server</strong>.</li>
                <li>Enter the Connection values shown on the right.</li>
                <li>Check <strong className="text-white">"I understand and want to continue"</strong> and click <strong className="text-white">Create</strong>.</li>
              </ol>

              <div className="p-4 rounded-2xl bg-[#090d16] border border-white/10 space-y-2">
                <span className="text-[11px] font-semibold text-[#34d399] block flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5" />
                  How to Use in ChatGPT
                </span>
                <p className="text-xs text-white/60 leading-relaxed">
                  When starting a chat, click the <strong className="text-white">+</strong> menu in composer → select <strong className="text-white">Developer mode</strong> → toggle on <strong className="text-white">Plexo</strong>.
                </p>
              </div>
            </div>

            <div className="space-y-4 bg-[#090d16] border border-white/10 p-5 rounded-2xl">
              <h3 className="text-xs font-mono text-white/40 uppercase tracking-wider">Plugin Field Values</h3>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="text-white/60 block mb-1">Name:</label>
                  <div className="p-2.5 bg-white/[0.04] border border-white/10 rounded-xl font-mono text-white select-all">
                    Plexo
                  </div>
                </div>

                <div>
                  <label className="text-white/60 block mb-1">Description:</label>
                  <div className="p-2.5 bg-white/[0.04] border border-white/10 rounded-xl font-mono text-white/80">
                    AI Native Page & Email Builder
                  </div>
                </div>

                <div>
                  <label className="text-white/60 block mb-1">Connection (Server URL):</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={serverMcpUrl}
                      className="w-full p-2.5 bg-white/[0.04] border border-white/10 rounded-xl font-mono text-[#34d399] select-all"
                    />
                    <button
                      onClick={() => handleCopy(serverMcpUrl, "chatgpt-url")}
                      className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition shrink-0"
                    >
                      {copiedKey === "chatgpt-url" ? <Check className="w-4 h-4 text-[#34d399]" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-white/60 block mb-1">Authentication:</label>
                  <div className="p-2.5 bg-white/[0.04] border border-white/10 rounded-xl font-mono text-[#34d399]">
                    OAuth
                  </div>
                </div>

                <div className="pt-2 border-t border-white/10 space-y-2">
                  <span className="text-[11px] font-mono text-white/50 block">Advanced OAuth Settings:</span>
                  <div className="text-[11px] font-mono text-white/70 space-y-1">
                    <div>Authorize URL: <code className="text-[#34d399]">{authorizeUrl}</code></div>
                    <div>Token URL: <code className="text-[#34d399]">{tokenUrl}</code></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "cursor" && (
        <div className="bg-[#111827]/80 border border-white/10 rounded-3xl p-6 md:p-8 space-y-6 shadow-xl">
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#818cf8]/10 border border-[#818cf8]/20 flex items-center justify-center text-[#818cf8]">
                <Terminal className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Cursor & Windsurf IDE Setup</h2>
                <p className="text-xs text-white/60">Add Plexo MCP server to <code className="text-[#818cf8]">.cursor/mcp.json</code> or Claude Desktop config.</p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-xs font-mono text-white/50 block">Config File Snippet:</label>
            <div className="relative">
              <pre className="p-4 bg-[#090d16] border border-white/10 rounded-2xl text-xs font-mono text-[#818cf8] overflow-x-auto">
                {cursorMcpConfig}
              </pre>
              <button
                onClick={() => handleCopy(cursorMcpConfig, "cursor")}
                className="absolute top-3 right-3 p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition"
              >
                {copiedKey === "cursor" ? <Check className="w-4 h-4 text-[#34d399]" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === "gpts" && (
        <div className="bg-[#111827]/80 border border-white/10 rounded-3xl p-6 md:p-8 space-y-6 shadow-xl">
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#34d399]/10 border border-[#34d399]/20 flex items-center justify-center text-[#34d399]">
                <Globe className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">ChatGPT Custom GPT Action Setup</h2>
                <p className="text-xs text-white/60">Import OpenAPI 3.1 schema in GPT Builder Editor.</p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <label className="text-xs font-mono text-white/50 block">OpenAPI Import URL:</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={`${baseUrl}/openapi.json`}
                className="w-full p-3 bg-[#090d16] border border-white/10 rounded-xl text-xs font-mono text-[#34d399] select-all"
              />
              <button
                onClick={() => handleCopy(`${baseUrl}/openapi.json`, "openapi-tab")}
                className="p-3 rounded-xl bg-white/10 hover:bg-white/20 text-white transition shrink-0"
              >
                {copiedKey === "openapi-tab" ? <Check className="w-4 h-4 text-[#34d399]" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>

            <div className="pt-4 border-t border-white/10">
              <a
                href="https://chatgpt.com/gpts/editor"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#34d399]/10 border border-[#34d399]/25 text-[#34d399] hover:bg-[#34d399]/20 text-xs font-semibold transition"
              >
                Open GPT Builder in ChatGPT
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
