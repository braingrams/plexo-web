"use client";

import { useState } from "react";
import { Code, Terminal, Globe, Check, Copy, Sparkles } from "lucide-react";
import { Reveal } from "@/app/scroll-fx";

type Tab = "sdk" | "mcp" | "api";

const CODE_EXAMPLES: Record<Tab, { title: string; filename: string; language: string; code: string }> = {
  sdk: {
    title: "Next.js / React SDK Embedding",
    filename: "components/BuilderCanvas.tsx",
    language: "typescript",
    code: `import { PlexoBuilder } from "@charisol/plexo-sdk";

export function BuilderCanvas({ pageId }: { pageId: string }) {
  return (
    <PlexoBuilder
      apiKey={process.env.NEXT_PUBLIC_PLEXO_API_KEY}
      templateId={pageId}
      mode="web_builder"
      customDomain="yourdomain.com"
      onPublish={async (site) => {
        await fetch("/api/webhooks/site-published", {
          method: "POST",
          body: JSON.stringify({ url: site.publishedUrl }),
        });
      }}
    />
  );
}`,
  },
  mcp: {
    title: "Cursor & Claude MCP Configuration",
    filename: ".cursor/mcp.json",
    language: "json",
    code: `{
  "mcpServers": {
    "plexo-mcp": {
      "command": "npx",
      "args": ["-y", "@charisol/plexo-mcp@latest"],
      "env": {
        "PLEXO_API_KEY": "plx_live_your_key_here",
        "PLEXO_APP_URL": "https://plexo.app"
      }
    }
  }
}`,
  },
  api: {
    title: "REST API & Eject Webhook Payload",
    filename: "POST /api/v1/templates/upload-raw",
    language: "json",
    code: `{
  "templateId": "tmpl_9941a8",
  "sourceType": "RAW_UPLOAD",
  "htmlContent": "<!DOCTYPE html><html><head><title>Clean Export</title></head><body><h1>Plexo</h1></body></html>",
  "assets": [
    { "filename": "style.css", "blobUrl": "https://blob.vercel-storage.com/asset-129.css" }
  ]
}`,
  },
};

export function DevCodePlayground({ isDark }: { isDark: boolean }) {
  const [activeTab, setActiveTab] = useState<Tab>("sdk");
  const [copied, setCopied] = useState(false);

  const current = CODE_EXAMPLES[activeTab];

  const handleCopy = () => {
    navigator.clipboard.writeText(current.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className={`py-20 md:py-28 px-4 sm:px-8 md:px-16 transition-colors duration-500 font-['Mulish',sans-serif] ${
      isDark ? "bg-[#0b0f19] text-white" : "bg-slate-50 text-slate-950"
    }`}>
      <div className="max-w-7xl mx-auto space-y-10">
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto space-y-4">
          <Reveal>
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <Sparkles className="w-4 h-4 text-purple-400" />
              <span>INTERACTIVE PLAYGROUND</span>
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight">
              Developer Code Reference
            </h2>
          </Reveal>

          <Reveal delay={0.2}>
            <p className={`text-base font-medium ${isDark ? "text-slate-400" : "text-slate-600"}`}>
              Explore implementation snippets for embedding the SDK, setting up MCP servers, or consuming REST endpoints.
            </p>
          </Reveal>
        </div>

        {/* Tab Buttons */}
        <Reveal delay={0.15}>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => setActiveTab("sdk")}
              className={`px-5 py-2.5 rounded-xl text-xs sm:text-sm font-extrabold transition-all ${
                activeTab === "sdk"
                  ? "bg-[#6b3bf9] text-white shadow-lg shadow-purple-600/30"
                  : isDark
                  ? "bg-slate-900 text-slate-400 hover:text-white border border-slate-800"
                  : "bg-white text-slate-700 hover:text-slate-950 border border-slate-200"
              }`}
            >
              Next.js SDK
            </button>

            <button
              onClick={() => setActiveTab("mcp")}
              className={`px-5 py-2.5 rounded-xl text-xs sm:text-sm font-extrabold transition-all ${
                activeTab === "mcp"
                  ? "bg-[#6b3bf9] text-white shadow-lg shadow-purple-600/30"
                  : isDark
                  ? "bg-slate-900 text-slate-400 hover:text-white border border-slate-800"
                  : "bg-white text-slate-700 hover:text-slate-950 border border-slate-200"
              }`}
            >
              MCP Config
            </button>

            <button
              onClick={() => setActiveTab("api")}
              className={`px-5 py-2.5 rounded-xl text-xs sm:text-sm font-extrabold transition-all ${
                activeTab === "api"
                  ? "bg-[#6b3bf9] text-white shadow-lg shadow-purple-600/30"
                  : isDark
                  ? "bg-slate-900 text-slate-400 hover:text-white border border-slate-800"
                  : "bg-white text-slate-700 hover:text-slate-950 border border-slate-200"
              }`}
            >
              REST API &amp; Webhooks
            </button>
          </div>
        </Reveal>

        {/* Code Box */}
        <Reveal delay={0.25}>
          <div className="max-w-4xl mx-auto bg-[#090d16] text-white rounded-3xl border border-slate-800 shadow-2xl overflow-hidden font-mono text-xs">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3 text-slate-400">
              <span className="font-bold text-purple-400">{current.filename}</span>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 hover:text-white transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? "Copied" : "Copy Code"}</span>
              </button>
            </div>

            <pre className="p-6 overflow-x-auto leading-relaxed text-slate-300">
              <code>{current.code}</code>
            </pre>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
