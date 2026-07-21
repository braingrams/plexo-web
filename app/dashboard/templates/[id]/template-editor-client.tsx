"use client";

/**
 * Template editor client.
 *
 * PlexoBuilder is a browser-only component (drag-and-drop, ResizeObserver).
 * It must never be rendered on the server. This file is loaded exclusively
 * via the next/dynamic wrapper in template-editor-dynamic.tsx (ssr: false).
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PlexoBuilder, type PlexoBuilderRef, type TemplateJSON } from "@charisol/plexo-sdk";
import "@charisol/plexo-sdk/dist/plexo-sdk.css";

type AiTier = "AUTO" | "BASIC" | "MEDIUM" | "HIGH";

type Props = {
  templateId: string;
  templateName: string;
  templateKind: "EMAIL" | "LANDING_PAGE";
  initialDesignJson: TemplateJSON;
  subscriptionPlan: string;
  useAi: boolean;
  aiProvider: string;
  aiTier: AiTier;
};

function IconArrowLeft() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 5l-7 7 7 7" />
    </svg>
  );
}

function IconSave() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

function IconMail() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="3" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function IconLayout() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M3 9h18M9 21V9" />
    </svg>
  );
}

export function TemplateEditorClient({
  templateId,
  templateName,
  templateKind,
  initialDesignJson,
  subscriptionPlan,
  useAi,
  aiProvider,
  aiTier,
}: Props) {
  const router = useRouter();
  const builderRef = useRef<PlexoBuilderRef>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const isEmail = templateKind === "EMAIL";

  async function handleSave(): Promise<void> {
    if (!builderRef.current) {
      setSaveError("Builder is not ready yet.");
      return;
    }
    setSaveError(null);
    setSaveMessage(null);
    setIsSaving(true);
    try {
      const mode = isEmail ? "email" : "landing_page";
      const exported = await builderRef.current.exportDesign(mode);
      const response = await fetch(`/api/templates/update/${templateId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ designJson: exported.json, compiledHtml: exported.html }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Unable to save template.");
      }
      setSaveMessage("Design saved successfully.");
      setTimeout(() => setSaveMessage(null), 3000);
      router.refresh();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to save template.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      {/* ── Header ───────────────────────────────── */}
      <header style={{
        flexShrink: 0,
        height: 56,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 1rem",
        background: "rgba(13,15,26,0.98)",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        zIndex: 10,
        gap: "1rem",
      }}>
        {/* Left: back + name */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", minWidth: 0 }}>
          <button
            type="button"
            onClick={() => router.push("/dashboard/templates")}
            style={{
              display: "flex", alignItems: "center", gap: "0.4rem",
              padding: "0.4rem 0.75rem",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "transparent",
              color: "rgba(240,242,255,0.6)",
              cursor: "pointer", fontFamily: "inherit",
              fontSize: "0.8rem", fontWeight: 600,
              whiteSpace: "nowrap",
              transition: "background 0.15s, color 0.15s",
            }}
          >
            <IconArrowLeft />
            Templates
          </button>

          <div style={{
            width: 1, height: 20,
            background: "rgba(255,255,255,0.1)",
            flexShrink: 0,
          }} />

          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: "0.3rem",
              padding: "0.2rem 0.55rem",
              borderRadius: 999,
              fontSize: "0.68rem", fontWeight: 700,
              letterSpacing: "0.06em", textTransform: "uppercase",
              background: isEmail ? "var(--brand-subtle)" : "rgba(129,140,248,0.1)",
              color: isEmail ? "var(--brand)" : "#818cf8",
              border: `1px solid ${isEmail ? "rgba(139,92,246,0.25)" : "rgba(129,140,248,0.2)"}`,
              flexShrink: 0,
            }}>
              {isEmail ? <IconMail /> : <IconLayout />}
              {isEmail ? "Email" : "Page"}
            </span>
            <h1 style={{
              fontFamily: "var(--font-heading), sans-serif",
              fontSize: "0.95rem", fontWeight: 700,
              color: "#f0f2ff",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {templateName}
            </h1>
          </div>
        </div>

        {/* Right: status + badges + save */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexShrink: 0 }}>
          {saveMessage && (
            <span style={{ fontSize: "0.78rem", color: "#34d399", whiteSpace: "nowrap" }}>
              ✓ {saveMessage}
            </span>
          )}
          {saveError && (
            <span style={{ fontSize: "0.78rem", color: "#f87171", whiteSpace: "nowrap", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
              {saveError}
            </span>
          )}

          <span style={{
            display: "none",
            padding: "0.2rem 0.6rem",
            borderRadius: 999,
            fontSize: "0.68rem", fontWeight: 700,
            letterSpacing: "0.06em", textTransform: "uppercase",
            background: "rgba(255,255,255,0.06)",
            color: "rgba(240,242,255,0.45)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
            className="sm:inline-flex"
          >
            {subscriptionPlan}
          </span>

          <button
            id="editor-save-btn"
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving}
            style={{
              display: "inline-flex", alignItems: "center", gap: "0.45rem",
              padding: "0.5rem 1rem",
              borderRadius: 9, border: "none", cursor: isSaving ? "not-allowed" : "pointer",
              fontSize: "0.85rem", fontWeight: 700,
              background: "linear-gradient(135deg, var(--brand), var(--brand-deep))",
              color: "#fff",
              opacity: isSaving ? 0.7 : 1,
              boxShadow: "0 3px 16px var(--brand-glow)",
              fontFamily: "inherit",
              transition: "opacity 0.15s, box-shadow 0.15s",
            }}
          >
            {isSaving ? (
              <span style={{
                width: 13, height: 13, borderRadius: "50%",
                border: "2px solid rgba(255,255,255,0.3)",
                borderTopColor: "#fff",
                animation: "spin 0.65s linear infinite",
                flexShrink: 0,
              }} />
            ) : (
              <IconSave />
            )}
            {isSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      {/* ── Builder Canvas ───────────────────────── */}
      <div style={{ flex: 1, overflow: "hidden", background: "#0a0c15" }}>
        <PlexoBuilder
          ref={builderRef}
          apiKey="workspace-internal"
          mode={isEmail ? "email" : "landing_page"}
          initialTemplate={initialDesignJson}
          backgroundColor="#0b1526"
          themeBgColor="#8b5cf6"
          themeFgColor="#ffffff"
          textColor="#ecfeff"
          showSaveButton={false}
          useAi={useAi}
          aiProvider={aiProvider}
          aiTier={aiTier}
          {...({ __internalPlan: subscriptionPlan } as any)}
        />
      </div>
    </div>
  );
}
