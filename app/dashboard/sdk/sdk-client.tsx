"use client";

import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "../_components/PageHeader";
import { Card } from "../_components/Card";

type SimpleKey = {
  id: string;
  name: string;
  maskedKey: string;
};

type Props = {
  initialKeys: SimpleKey[];
};

function IconTerminal() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}

function IconCopy() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
  );
}

function IconLink() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" />
    </svg>
  );
}

export function SdkClient({ initialKeys }: Props) {
  const [selectedKeyId, setSelectedKeyId] = useState<string>(initialKeys[0]?.id ?? "");
  const [copiedInstall, setCopiedInstall] = useState(false);
  const [copiedReact, setCopiedReact] = useState(false);
  const [copiedNode, setCopiedNode] = useState(false);

  const selectedKey = initialKeys.find((k) => k.id === selectedKeyId);
  const keyValue = selectedKey ? `${selectedKey.maskedKey} (active)` : "YOUR_PLEXO_API_KEY";

  const installCode = `npm install @charisol/plexo-sdk`;

  const reactCode = `import React, { useRef } from 'react';
import { PlexoBuilder, type PlexoBuilderRef } from '@charisol/plexo-sdk';

export default function MyBuilderPage() {
  const builderRef = useRef<PlexoBuilderRef>(null);

  const handleSave = async () => {
    if (builderRef.current) {
      // Export design config (JSON) and compiled responsive HTML
      const { json, html } = await builderRef.current.exportDesign('email');
      
      // Save to your database
      await fetch('/api/templates/save', {
        method: 'POST',
        body: JSON.stringify({ json, html }),
      });
    }
  };

  return (
    <div style={{ height: '85vh' }}>
      <PlexoBuilder
        ref={builderRef}
        apiKey="${keyValue}"
        mode="email" // or 'landing_page'
        themeBgColor="var(--brand)"
        textColor="#ffffff"
        useAi={true}
      />
      <button onClick={handleSave}>Save Design</button>
    </div>
  );
}`;

  const nodeCode = `import { compileToHTML, compileToPlainText } from '@charisol/plexo-sdk';

// 1. Fetch template JSON configuration from your db
const template = await db.templates.findUnique({ where: { id: '...' } });

// 2. Compile to production-ready, cross-client responsive HTML
const html = compileToHTML(template.designJson);

// 3. Compile to plain text backup for email delivery
const text = compileToPlainText(template.designJson);
`;

  async function copyText(text: string, setCopied: (v: boolean) => void) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <PageHeader
        eyebrow="Integration"
        title="Plexo SDK Client"
        subtitle="Connect your application visually and programmatically using our SDK."
      />

      {/* Select key warning/option */}
      <Card padded={false} style={{ padding: "1rem 1.25rem", marginBottom: "1.25rem" }}>
        <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "0.95rem", fontWeight: 700, color: "#f0f2ff", marginBottom: "0.5rem" }}>
          Select Active API Key to Inject in Snippets
        </h2>
        {initialKeys.length === 0 ? (
          <p style={{ fontSize: "0.82rem", color: "rgba(240,242,255,0.45)" }}>
            No active API keys found. Visit the{" "}
            <Link href="/dashboard/settings" style={{ color: "var(--brand)", fontWeight: 600, textDecoration: "none" }}>
              Developer Settings
            </Link>
            {" "}page to generate a key first.
          </p>
        ) : (
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={selectedKeyId}
              onChange={(e) => setSelectedKeyId(e.target.value)}
              className="field-select"
              style={{ width: "100%", maxWidth: "100%" }}
            >
              {initialKeys.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name} ({k.maskedKey})
                </option>
              ))}
            </select>
            <span style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.35)", lineHeight: 1.4 }}>
              The selected key will be injected directly into the copy-paste integration blocks below.
            </span>
          </div>
        )}
      </Card>

      <div style={{ display: "grid", gap: "1.25rem", gridTemplateColumns: "1fr" }}>

        {/* 1. Install */}
        <Card padded={false} style={{ padding: "1rem 0.85rem", overflow: "hidden", maxWidth: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.6rem", flexWrap: "wrap", gap: "0.5rem", width: "100%" }}>
            <h3 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "0.95rem", fontWeight: 700, color: "#f0f2ff", display: "flex", alignItems: "center", gap: "0.5rem", flex: "1 1 200px", minWidth: 0, wordBreak: "break-word" }}>
              <span style={{ color: "var(--brand)", flexShrink: 0 }}><IconTerminal /></span>
              Step 1: Install Package
            </h3>
            <button
              onClick={() => void copyText(installCode, setCopiedInstall)}
              style={{
                background: "none", border: "none", cursor: "pointer",
                display: "flex", alignItems: "center", gap: "0.35rem",
                color: copiedInstall ? "#34d399" : "rgba(240,242,255,0.4)",
                fontSize: "0.75rem", fontWeight: 600, fontFamily: "inherit",
                flexShrink: 0, marginLeft: "auto",
              }}
            >
              {copiedInstall ? <IconCheck /> : <IconCopy />}
              {copiedInstall ? "Copied!" : "Copy"}
            </button>
          </div>
          <div style={{ width: "100%", overflowX: "auto" }}>
            <pre style={{
              background: "rgba(0, 0, 0, 0.4)", border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 10, padding: "0.75rem 0.85rem", fontFamily: "monospace", fontSize: "0.8rem",
              color: "var(--brand)", overflowX: "auto", maxWidth: "100%", whiteSpace: "pre",
            }}>
              {installCode}
            </pre>
          </div>
        </Card>

        {/* 2. Embedded component */}
        <Card padded={false} style={{ padding: "1rem 0.85rem", overflow: "hidden", maxWidth: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.6rem", flexWrap: "wrap", gap: "0.5rem", width: "100%" }}>
            <h3 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "0.95rem", fontWeight: 700, color: "#f0f2ff", flex: "1 1 200px", minWidth: 0, wordBreak: "break-word" }}>
              Step 2: Embed the Builder Component (React / Next.js)
            </h3>
            <button
              onClick={() => void copyText(reactCode, setCopiedReact)}
              style={{
                background: "none", border: "none", cursor: "pointer",
                display: "flex", alignItems: "center", gap: "0.35rem",
                color: copiedReact ? "#34d399" : "rgba(240,242,255,0.4)",
                fontSize: "0.75rem", fontWeight: 600, fontFamily: "inherit",
                flexShrink: 0, marginLeft: "auto",
              }}
            >
              {copiedReact ? <IconCheck /> : <IconCopy />}
              {copiedReact ? "Copied!" : "Copy"}
            </button>
          </div>
          <div style={{ width: "100%", overflowX: "auto" }}>
            <pre style={{
              background: "rgba(0, 0, 0, 0.4)", border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 10, padding: "0.85rem", fontFamily: "monospace", fontSize: "0.78rem",
              color: "rgba(240,242,255,0.85)", overflowX: "auto", lineHeight: 1.5,
              maxWidth: "100%", whiteSpace: "pre",
            }}>
              {reactCode}
            </pre>
          </div>
        </Card>

        {/* 3. Server-side compilation */}
        <Card padded={false} style={{ padding: "1rem 0.85rem", overflow: "hidden", maxWidth: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.6rem", flexWrap: "wrap", gap: "0.5rem", width: "100%" }}>
            <h3 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "0.95rem", fontWeight: 700, color: "#f0f2ff", flex: "1 1 200px", minWidth: 0, wordBreak: "break-word" }}>
              Step 3: Server compilation (Next.js server-side, Node.js backend)
            </h3>
            <button
              onClick={() => void copyText(nodeCode, setCopiedNode)}
              style={{
                background: "none", border: "none", cursor: "pointer",
                display: "flex", alignItems: "center", gap: "0.35rem",
                color: copiedNode ? "#34d399" : "rgba(240,242,255,0.4)",
                fontSize: "0.75rem", fontWeight: 600, fontFamily: "inherit",
                flexShrink: 0, marginLeft: "auto",
              }}
            >
              {copiedNode ? <IconCheck /> : <IconCopy />}
              {copiedNode ? "Copied!" : "Copy"}
            </button>
          </div>
          <div style={{ width: "100%", overflowX: "auto" }}>
            <pre style={{
              background: "rgba(0, 0, 0, 0.4)", border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 10, padding: "0.85rem", fontFamily: "monospace", fontSize: "0.78rem",
              color: "rgba(240,242,255,0.85)", overflowX: "auto", lineHeight: 1.5,
              maxWidth: "100%", whiteSpace: "pre",
            }}>
              {nodeCode}
            </pre>
          </div>
        </Card>

        {/* Documentation links */}
        <div style={{
          background: "linear-gradient(135deg, rgba(139,92,246,0.08) 0%, rgba(100,50,255,0.06) 100%)",
          border: "1px solid rgba(139,92,246,0.15)", borderRadius: 16, padding: "1.5rem",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap",
        }}>
          <div>
            <h4 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "0.95rem", fontWeight: 700, color: "#f0f2ff" }}>
              Looking for full API specifications?
            </h4>
            <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.45)", marginTop: "0.25rem" }}>
              Browse the complete list of types, helper methods, design tokens, and compile functions.
            </p>
          </div>
          <Link href="/sdk" target="_blank" style={{
            display: "inline-flex", alignItems: "center", gap: "0.45rem",
            padding: "0.6rem 1.1rem", borderRadius: 9,
            background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
            color: "#f0f2ff", fontSize: "0.82rem", fontWeight: 600, textDecoration: "none",
            transition: "background 0.15s",
          }}>
            Public Docs
            <IconLink />
          </Link>
        </div>

      </div>
    </>
  );
}
