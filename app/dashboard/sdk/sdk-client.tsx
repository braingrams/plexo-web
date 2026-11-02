"use client";

import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "../_components/PageHeader";
import { Card } from "../_components/Card";
import { IntegrationSubTabs } from "../integrations/_components/IntegrationSubTabs";
import { CustomSelect } from "@/app/_components/CustomSelect";
import { SDK_V2_API, SDK_V2_COMPILE, SDK_V2_EMBED, SDK_V2_INSTALL } from "@/lib/sdk/v2-snippets";
import { V2Playground } from "./v2-playground";

type SimpleKey = {
  id: string;
  name: string;
  maskedKey: string;
};

type Props = {
  initialKeys: SimpleKey[];
  initialManageLandingPagePublishing: boolean;
  isUltra: boolean;
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

export function SdkClient({ initialKeys, initialManageLandingPagePublishing, isUltra }: Props) {
  const [selectedKeyId, setSelectedKeyId] = useState<string>(initialKeys[0]?.id ?? "");
  const [copiedInstall, setCopiedInstall] = useState(false);
  const [copiedReact, setCopiedReact] = useState(false);
  const [copiedNode, setCopiedNode] = useState(false);
  const [tab, setTab] = useState<"v2" | "classic">("v2");
  const [copiedV2, setCopiedV2] = useState<string | null>(null);
  const [manageLandingPagePublishing, setManageLandingPagePublishing] = useState<boolean>(initialManageLandingPagePublishing);
  const [publishSettingSaving, setPublishSettingSaving] = useState(false);
  const [publishSettingError, setPublishSettingError] = useState<string | null>(null);

  async function toggleManageLandingPagePublishing(): Promise<void> {
    if (!isUltra) return;
    const next = !manageLandingPagePublishing;
    setManageLandingPagePublishing(next);
    setPublishSettingSaving(true);
    setPublishSettingError(null);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manageLandingPagePublishing: next }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "Unable to update this setting.");
      }
    } catch (error) {
      setManageLandingPagePublishing(!next);
      setPublishSettingError(error instanceof Error ? error.message : "Unable to update this setting.");
    } finally {
      setPublishSettingSaving(false);
    }
  }

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

  async function copyV2(id: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopiedV2(id);
    setTimeout(() => setCopiedV2(null), 2000);
  }

  const v2Steps: Array<{ id: string; title: string; note: string; code: string }> = [
    { id: "install", title: "Step 1: Install", note: "", code: SDK_V2_INSTALL },
    { id: "embed", title: "Step 2: Add the editor", note: "Everything is optional: with no props you get a complete builder on a blank page.", code: SDK_V2_EMBED },
    { id: "compile", title: "Step 3: Turn pages into HTML on your server", note: "Runs anywhere on your backend. No React or editor needed.", code: SDK_V2_COMPILE },
    { id: "api", title: "Or compile with a hosted call", note: "Uses your API key. Up to 50 pages and 2 MB per request.", code: SDK_V2_API.replace("process.env.PLEXO_API_KEY!", selectedKey ? `process.env.PLEXO_API_KEY! /* ${selectedKey.maskedKey} */` : "process.env.PLEXO_API_KEY!") },
  ];

  async function copyText(text: string, setCopied: (v: boolean) => void) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <IntegrationSubTabs />
      <PageHeader
        eyebrow="Integration"
        title="Plexo SDK Client"
        subtitle="Add a visual website builder to your own product. SDK 2 is recommended; the classic builder keeps working."
      />

      <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.4)", marginTop: "-0.75rem", marginBottom: "1.25rem" }}>
        Testing HTML/JSON by hand instead?{" "}
        <Link href="/dashboard/compile" style={{ color: "var(--brand)", textDecoration: "underline" }}>
          Open the Compile tool
        </Link>
      </p>

      <div role="tablist" aria-label="SDK version" style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
        {([["v2", "SDK 2 (recommended)"], ["classic", "Classic (V1)"]] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            style={{
              padding: "0.5rem 1.1rem", borderRadius: 999, cursor: "pointer", fontFamily: "inherit", fontSize: "0.82rem", fontWeight: 700,
              border: tab === id ? "1px solid var(--brand)" : "1px solid rgba(255,255,255,0.12)",
              background: tab === id ? "var(--brand-subtle)" : "transparent",
              color: tab === id ? "var(--brand)" : "rgba(240,242,255,0.6)",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Select key warning/option */}
      <Card padded={false} style={{ padding: "1rem 1.25rem", marginBottom: "1.25rem" }}>
        <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "0.95rem", fontWeight: 700, color: "#f0f2ff", marginBottom: "0.5rem" }}>
          Select Active API Key to Inject in Snippets
        </h2>
        {initialKeys.length === 0 ? (
          <p style={{ fontSize: "0.82rem", color: "rgba(240,242,255,0.45)" }}>
            No active API keys found. Visit the{" "}
            <Link href="/dashboard/settings/api-keys" style={{ color: "var(--brand)", fontWeight: 600, textDecoration: "none" }}>
              API Keys
            </Link>
            {" "}page to generate a key first.
          </p>
        ) : (
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 260px" }}>
              <CustomSelect
                value={selectedKeyId}
                options={initialKeys.map((k) => ({ label: `${k.name} (${k.maskedKey})`, value: k.id }))}
                onChange={setSelectedKeyId}
              />
            </div>
            <span style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.35)", lineHeight: 1.4 }}>
              The selected key will be injected directly into the copy-paste integration blocks below.
            </span>
          </div>
        )}
      </Card>

      {/* Landing page publishing — an embedded-SDK-builder setting, not really "content"
          for this page's own copy-paste snippets, but the closest fit: it governs how a
          host app using this SDK is allowed to publish on your behalf. */}
      <Card style={{ marginBottom: "1.25rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
          <div>
            <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "1rem", fontWeight: 700, color: "#f0f2ff", marginBottom: "0.35rem" }}>
              Landing Page Publishing
            </h2>
            <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.35)", maxWidth: 520 }}>
              Let embedded SDK builders publish landing pages directly to your account&apos;s domain limit, with no cap on how many domains they publish.
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexShrink: 0 }}>
            {!isUltra && (
              <span style={{ fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--brand)", background: "var(--brand-subtle)", padding: "0.2rem 0.5rem", borderRadius: 5 }}>
                Requires Ultra
              </span>
            )}
            <button
              type="button"
              role="switch"
              aria-checked={manageLandingPagePublishing}
              id="toggle-manage-landing-page-publishing"
              disabled={!isUltra || publishSettingSaving}
              onClick={() => void toggleManageLandingPagePublishing()}
              style={{
                position: "relative", width: 44, height: 24, borderRadius: 999,
                background: manageLandingPagePublishing ? "var(--brand)" : "rgba(255,255,255,0.1)",
                border: manageLandingPagePublishing ? "1px solid var(--brand)" : "1px solid rgba(255,255,255,0.12)",
                cursor: (isUltra && !publishSettingSaving) ? "pointer" : "not-allowed",
                opacity: isUltra ? 1 : 0.5,
                transition: "background 0.2s, border-color 0.2s", flexShrink: 0,
              }}
            >
              <span style={{ position: "absolute", top: 3, left: manageLandingPagePublishing ? 22 : 3, width: 16, height: 16, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.3)", transition: "left 0.2s cubic-bezier(0.4,0,0.2,1)" }} />
            </button>
          </div>
        </div>

        {!isUltra && (
          <p style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.4)", marginTop: "1rem" }}>
            Upgrade to Ultra on the Subscription page to unlock self-managed publishing.
          </p>
        )}
        {publishSettingError && (
          <p style={{ fontSize: "0.78rem", color: "#f87171", marginTop: "0.75rem" }}>{publishSettingError}</p>
        )}
      </Card>

      {tab === "v2" && (
        <div style={{ display: "grid", gap: "1.25rem", gridTemplateColumns: "1fr", marginBottom: "1.25rem" }}>
          <Card padded={false} style={{ padding: "1rem 0.85rem" }}>
            <h3 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "0.95rem", fontWeight: 700, color: "#f0f2ff", marginBottom: "0.4rem" }}>
              Try SDK 2 right here
            </h3>
            <V2Playground />
          </Card>

          {v2Steps.map((step) => (
            <Card key={step.id} padded={false} style={{ padding: "1rem 0.85rem", overflow: "hidden", maxWidth: "100%" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.4rem", flexWrap: "wrap", gap: "0.5rem" }}>
                <h3 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "0.95rem", fontWeight: 700, color: "#f0f2ff", flex: "1 1 200px", minWidth: 0 }}>{step.title}</h3>
                <button
                  onClick={() => void copyV2(step.id, step.code)}
                  style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.35rem", color: copiedV2 === step.id ? "#34d399" : "rgba(240,242,255,0.4)", fontSize: "0.75rem", fontWeight: 600, fontFamily: "inherit", marginLeft: "auto" }}
                >
                  {copiedV2 === step.id ? <IconCheck /> : <IconCopy />}
                  {copiedV2 === step.id ? "Copied!" : "Copy"}
                </button>
              </div>
              {step.note && <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.45)", margin: "0 0 0.6rem" }}>{step.note}</p>}
              <div style={{ width: "100%", overflowX: "auto" }}>
                <pre style={{ background: "rgba(0, 0, 0, 0.4)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "0.85rem", fontFamily: "monospace", fontSize: "0.78rem", color: "rgba(240,242,255,0.85)", overflowX: "auto", lineHeight: 1.5, maxWidth: "100%", whiteSpace: "pre", margin: 0 }}>
                  {step.code}
                </pre>
              </div>
            </Card>
          ))}
        </div>
      )}

      {tab === "classic" && (
      <div style={{ display: "grid", gap: "1.25rem", gridTemplateColumns: "1fr" }}>
        <p style={{ fontSize: "0.82rem", color: "rgba(240,242,255,0.5)", margin: 0 }}>
          The classic builder is unchanged and fully supported. Your existing integration needs no changes.
        </p>

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

        </div>
      )}

    </>
  );
}
