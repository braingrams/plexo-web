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
  const [activeTab, setActiveTab] = useState<"claude" | "chatgpt" | "cursor" | "gpts" | "hostManaged">("claude");

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

  const generateSecretCommand = `openssl rand -hex 32`;

  const hostManagedPayloadShape = JSON.stringify(
    {
      externalUserId: "your own id for the end user driving the builder",
      actionMode: "edit_element | edit_layout | generate_layout",
      tier: "BASIC | MEDIUM | HIGH",
      requestId: "uuid, same value on the matching authorize + charge call",
      usage: "{ inputTokens, outputTokens } — only present on /ai-charge",
    },
    null,
    2
  );

  const hostManagedSignatureSnippet = `import { createHmac, timingSafeEqual } from "node:crypto";

function verifyPlexoSignature(secret, timestamp, rawBody, signature) {
  const skewMs = Math.abs(Date.now() - Number(timestamp));
  if (!Number.isFinite(skewMs) || skewMs > 5 * 60 * 1000) return false; // reject stale/replayed requests

  const expected = createHmac("sha256", secret)
    .update(\`\${timestamp}.\${rawBody}\`, "utf8")
    .digest("hex");

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

// req.headers["x-plexo-timestamp"], req.headers["x-plexo-signature"]
// rawBody must be the exact raw request bytes, not a re-serialized copy`;

  const hostManagedResponseShapes = `POST {yourWebhookUrl}/ai-authorize
  -> 200 { "allowed": true }
  -> 200 { "allowed": false, "reason": "shown to the end user" }

POST {yourWebhookUrl}/ai-charge
  -> any 2xx to acknowledge (body not checked)
  -> deduplicate on requestId — retried a few times on failure/timeout`;

  return (
    <div className="max-w-[1500px] mx-auto p-0 sm:p-4 md:p-6 space-y-6 font-sans text-[#f0f2ff]">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-white/10">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#8b5cf6] to-[#7c3aed] flex items-center justify-center shadow-lg shadow-[#8b5cf6]/25 shrink-0">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg sm:text-2xl font-bold text-white tracking-tight leading-snug">
                AI & MCP Integration Hub{" "}
                <Sparkles className="w-4 h-4 text-[#a78bfa] inline-block align-middle" />
              </h1>
              <p className="text-xs sm:text-sm text-white/60 mt-0.5">
                Connect Claude, ChatGPT, Cursor, and Gemini to generate, compile, and publish landing pages directly from chat.
              </p>
            </div>
          </div>
        </div>

        <a
          href="/mcp/login"
          target="_blank"
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#8b5cf6]/10 border border-[#8b5cf6]/25 text-[#a78bfa] hover:bg-[#8b5cf6]/20 text-xs font-semibold transition shrink-0 self-start sm:self-auto"
        >
          <Lock className="w-4 h-4" />
          Authenticate Session Token
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* ── Tabs Selector ─────────────────────────────────────── */}
      <div className="flex items-center gap-2 border-b border-white/10 pb-4 overflow-x-auto no-scrollbar">
        {[
          { id: "claude", label: "Claude Custom Connectors", icon: Sparkles },
          { id: "chatgpt", label: "ChatGPT Developer Plugin / Remote MCP", icon: Bot },
          { id: "cursor", label: "Cursor & Windsurf IDE", icon: Terminal },
          { id: "gpts", label: "ChatGPT Custom GPT Action", icon: Globe },
          { id: "hostManaged", label: "Host-Managed AI (Ultra)", icon: ShieldCheck },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition whitespace-nowrap ${
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
        <div className="bg-[#111827]/80 border border-white/10 rounded-2xl sm:rounded-3xl p-4 sm:p-6 md:p-8 space-y-6 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[#8b5cf6]/10 border border-[#8b5cf6]/20 flex items-center justify-center text-[#8b5cf6] shrink-0">
                <Sparkles className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-bold text-white leading-tight">Claude Web Custom Connector Setup</h2>
                <p className="text-xs text-white/60 mt-0.5">Connect Plexo in Claude Web under <code className="text-[#a78bfa]">Customize → Connectors</code>.</p>
              </div>
            </div>
            <span className="text-xs font-mono px-2.5 py-1 rounded-lg bg-[#8b5cf6]/10 text-[#a78bfa] border border-[#8b5cf6]/20 self-start sm:self-auto shrink-0">
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
                  <div className="flex items-center gap-2 min-w-0">
                    <input
                      type="text"
                      readOnly
                      value={serverMcpUrl}
                      className="w-full min-w-0 p-2.5 bg-white/[0.04] border border-white/10 rounded-xl font-mono text-[#a78bfa] select-all truncate"
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
                  <div className="p-2.5 bg-white/[0.04] border border-white/10 rounded-xl font-mono text-white/80 break-all select-all overflow-x-auto">
                    plexo_mcp_client
                  </div>
                </div>

                <div>
                  <label className="text-white/60 block mb-1">OAuth Client Secret (Optional / Advanced):</label>
                  <div className="p-2.5 bg-white/[0.04] border border-white/10 rounded-xl font-mono text-white/80 break-all select-all overflow-x-auto">
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
                  <div className="flex items-center gap-2 min-w-0">
                    <input
                      type="text"
                      readOnly
                      value={serverMcpUrl}
                      className="w-full min-w-0 p-2.5 bg-white/[0.04] border border-white/10 rounded-xl font-mono text-[#34d399] select-all truncate"
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
                  <div className="text-[11px] font-mono text-white/70 space-y-2 min-w-0">
                    <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 min-w-0">
                      <span className="shrink-0 text-white/50">Authorize URL:</span>
                      <code className="text-[#34d399] break-all select-all bg-white/[0.04] px-2 py-1 rounded-lg border border-white/10 font-mono text-[11px] max-w-full overflow-x-auto block sm:inline-block">{authorizeUrl}</code>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 min-w-0">
                      <span className="shrink-0 text-white/50">Token URL:</span>
                      <code className="text-[#34d399] break-all select-all bg-white/[0.04] px-2 py-1 rounded-lg border border-white/10 font-mono text-[11px] max-w-full overflow-x-auto block sm:inline-block">{tokenUrl}</code>
                    </div>
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
              <pre className="p-4 bg-[#090d16] border border-white/10 rounded-2xl text-xs font-mono text-[#818cf8] overflow-x-auto max-w-full whitespace-pre-wrap break-all sm:whitespace-pre">
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
            <div className="flex items-center gap-2 min-w-0">
              <input
                type="text"
                readOnly
                value={`${baseUrl}/openapi.json`}
                className="w-full min-w-0 p-3 bg-[#090d16] border border-white/10 rounded-xl text-xs font-mono text-[#34d399] select-all truncate"
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

      {activeTab === "hostManaged" && (
        <div className="bg-[#111827]/80 border border-white/10 rounded-2xl sm:rounded-3xl p-4 sm:p-6 md:p-8 space-y-6 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[#22d3ee]/10 border border-[#22d3ee]/20 flex items-center justify-center text-[#22d3ee] shrink-0">
                <ShieldCheck className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-bold text-white leading-tight">Host-Managed AI Access</h2>
                <p className="text-xs text-white/60 mt-0.5">
                  Let your own backend authorize and bill AI usage for your end users instead of Plexo&apos;s credit ledger.
                </p>
              </div>
            </div>
            <span className="text-xs font-mono px-2.5 py-1 rounded-lg bg-[#22d3ee]/10 text-[#22d3ee] border border-[#22d3ee]/20 self-start sm:self-auto shrink-0">
              Ultra plan only
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Sliders className="w-4 h-4 text-[#22d3ee]" />
                Step-by-Step Instructions
              </h3>
              <ol className="space-y-3 text-xs text-white/70 list-decimal list-inside leading-relaxed">
                <li>Generate a random secret yourself — Plexo doesn&apos;t issue one, it&apos;s symmetric like a GitHub webhook secret (command on the right).</li>
                <li>Implement two endpoints on your own backend: <code className="text-[#22d3ee]">POST {"{yourWebhookUrl}"}/ai-authorize</code> and <code className="text-[#22d3ee]">POST {"{yourWebhookUrl}"}/ai-charge</code>.</li>
                <li>Verify the <code className="text-[#22d3ee]">x-plexo-signature</code> header on every request before trusting it (snippet on the right).</li>
                <li>
                  In <a href="/dashboard/settings" className="text-[#22d3ee] underline">Settings</a>, pick the API key, set <strong className="text-white">AI Access Mode</strong> to <strong className="text-white">Host-Managed</strong>, then paste your webhook URL and the secret from step 1.
                </li>
                <li>Set that identical secret in your own backend&apos;s environment — nothing is copied <em>from</em> Plexo, the value just needs to match in both places.</li>
              </ol>

              <div className="p-4 rounded-2xl bg-[#090d16] border border-white/10 space-y-2">
                <span className="text-[11px] font-semibold text-[#22d3ee] block flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5" />
                  Fails closed
                </span>
                <p className="text-xs text-white/60 leading-relaxed">
                  If your webhook is unreachable, times out, or denies the request, the AI action is blocked — Plexo never falls back to billing it against its own System AI credits. Requires the account to be on the Ultra plan; a downgrade blocks Host-Managed requests (403) until it&apos;s back on Ultra.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-mono text-white/50 block">1. Generate a Secret:</label>
                <div className="relative">
                  <pre className="p-3 bg-[#090d16] border border-white/10 rounded-2xl text-xs font-mono text-[#22d3ee] overflow-x-auto">
                    {generateSecretCommand}
                  </pre>
                  <button
                    onClick={() => handleCopy(generateSecretCommand, "hm-secret")}
                    className="absolute top-2.5 right-2.5 p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition"
                  >
                    {copiedKey === "hm-secret" ? <Check className="w-3.5 h-3.5 text-[#34d399]" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-mono text-white/50 block">2. Request Payload (both endpoints):</label>
                <div className="relative">
                  <pre className="p-4 bg-[#090d16] border border-white/10 rounded-2xl text-xs font-mono text-[#22d3ee] overflow-x-auto max-w-full whitespace-pre-wrap break-all sm:whitespace-pre">
                    {hostManagedPayloadShape}
                  </pre>
                  <button
                    onClick={() => handleCopy(hostManagedPayloadShape, "hm-payload")}
                    className="absolute top-3 right-3 p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition"
                  >
                    {copiedKey === "hm-payload" ? <Check className="w-4 h-4 text-[#34d399]" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-mono text-white/50 block">3. Verify the Signature (Node.js):</label>
                <div className="relative">
                  <pre className="p-4 bg-[#090d16] border border-white/10 rounded-2xl text-xs font-mono text-[#22d3ee] overflow-x-auto max-w-full whitespace-pre-wrap break-all sm:whitespace-pre">
                    {hostManagedSignatureSnippet}
                  </pre>
                  <button
                    onClick={() => handleCopy(hostManagedSignatureSnippet, "hm-sig")}
                    className="absolute top-3 right-3 p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition"
                  >
                    {copiedKey === "hm-sig" ? <Check className="w-4 h-4 text-[#34d399]" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-mono text-white/50 block">4. Expected Responses:</label>
                <div className="relative">
                  <pre className="p-4 bg-[#090d16] border border-white/10 rounded-2xl text-xs font-mono text-[#22d3ee] overflow-x-auto max-w-full whitespace-pre-wrap break-all sm:whitespace-pre">
                    {hostManagedResponseShapes}
                  </pre>
                  <button
                    onClick={() => handleCopy(hostManagedResponseShapes, "hm-resp")}
                    className="absolute top-3 right-3 p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition"
                  >
                    {copiedKey === "hm-resp" ? <Check className="w-4 h-4 text-[#34d399]" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <a
                href="/dashboard/settings"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#22d3ee]/10 border border-[#22d3ee]/25 text-[#22d3ee] hover:bg-[#22d3ee]/20 text-xs font-semibold transition"
              >
                Go to Settings to configure it
                <ChevronRight className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
