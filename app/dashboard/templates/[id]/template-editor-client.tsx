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
  aiApiKey: string | null;
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
  aiApiKey,
}: Props) {
  const router = useRouter();
  const builderRef = useRef<PlexoBuilderRef>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [modalDomainType, setModalDomainType] = useState<"SUBDOMAIN" | "CUSTOM">("SUBDOMAIN");
  const [modalSubdomainPrefix, setModalSubdomainPrefix] = useState("");
  const [modalCustomDomain, setModalCustomDomain] = useState("");
  const [modalIsSubmitting, setModalIsSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalSuccess, setModalSuccess] = useState<string | null>(null);
  const [baseDomain, setBaseDomain] = useState("plexo.charisol.io");

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

      // Check if it's a landing page and doesn't have a linked domain
      if (templateKind === "LANDING_PAGE") {
        try {
          const checkRes = await fetch(`/api/v1/domains?templateId=${templateId}`);
          const checkData = await checkRes.json();
          if (checkData.domains && checkData.domains.length === 0) {
            if (checkData.baseDomain) {
              setBaseDomain(checkData.baseDomain);
            }
            setShowPublishModal(true);
          }
        } catch (e) {
          console.error("Failed to check domain status:", e);
        }
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to save template.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleModalPublish(e: React.FormEvent) {
    e.preventDefault();
    setModalError(null);
    setModalSuccess(null);

    const inputDomain = modalDomainType === "SUBDOMAIN" ? modalSubdomainPrefix : modalCustomDomain;
    if (!inputDomain.trim()) {
      setModalError("Please enter a domain name.");
      return;
    }

    setModalIsSubmitting(true);
    try {
      const response = await fetch("/api/v1/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId,
          type: modalDomainType,
          domain: inputDomain,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to publish domain.");
      }
      setModalSuccess("Landing page published successfully!");
      
      // Update local storage key domain mapping config to sync immediately
      try {
        const key = `plexo-published-domain-${templateId}`;
        localStorage.setItem(key, JSON.stringify({ domain: data.domain.domain, type: modalDomainType }));
      } catch (err) {
        console.warn(err);
      }

      setTimeout(() => {
        setShowPublishModal(false);
        setModalSuccess(null);
        setModalSubdomainPrefix("");
        setModalCustomDomain("");
      }, 2000);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : "Publish failed.");
    } finally {
      setModalIsSubmitting(false);
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
          aiApiKey={aiApiKey || undefined}
          allowPublishLandingPage={templateKind === "LANDING_PAGE"}
          templateId={templateId}
          {...({ __internalPlan: subscriptionPlan } as any)}
        />
      </div>

      {/* ── Publish Modal Popup ──────────────────── */}
      {showPublishModal && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(3, 7, 18, 0.85)", zIndex: 100,
          display: "grid", placeItems: "center", backdropFilter: "blur(8px)",
          animation: "fadeIn 0.2s ease-out"
        }}>
          <div style={{
            background: "#0d1324", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 16, width: "90%", maxWidth: 460, padding: "1.75rem",
            boxShadow: "0 20px 50px rgba(0,0,0,0.5)"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
              <h2 style={{ fontSize: "1.2rem", fontWeight: 800, color: "#f0f2ff", fontFamily: "var(--font-heading)" }}>
                🚀 Publish Landing Page
              </h2>
              <button
                onClick={() => setShowPublishModal(false)}
                style={{ background: "none", border: "none", color: "rgba(240,242,255,0.4)", cursor: "pointer", fontSize: "1.1rem" }}
              >
                ✕
              </button>
            </div>
            
            <p style={{ fontSize: "0.82rem", color: "rgba(240,242,255,0.6)", lineHeight: 1.5, marginBottom: "1.25rem" }}>
              Your changes have been saved! Would you like to publish this landing page to a subdomain or custom domain?
            </p>

            <form onSubmit={handleModalPublish} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {/* Type Switch */}
              <div style={{ display: "flex", background: "rgba(255,255,255,0.04)", padding: 3, borderRadius: 8, gap: 2 }}>
                <button
                  type="button"
                  onClick={() => setModalDomainType("SUBDOMAIN")}
                  style={{
                    flex: 1, padding: "0.35rem", fontSize: "0.78rem", fontWeight: 600, border: "none", cursor: "pointer", borderRadius: 6,
                    background: modalDomainType === "SUBDOMAIN" ? "var(--brand)" : "transparent",
                    color: modalDomainType === "SUBDOMAIN" ? "#fff" : "rgba(240,242,255,0.55)",
                    transition: "all 0.15s"
                  }}
                >
                  Subdomain
                </button>
                <button
                  type="button"
                  onClick={() => setModalDomainType("CUSTOM")}
                  style={{
                    flex: 1, padding: "0.35rem", fontSize: "0.78rem", fontWeight: 600, border: "none", cursor: "pointer", borderRadius: 6,
                    background: modalDomainType === "CUSTOM" ? "var(--brand)" : "transparent",
                    color: modalDomainType === "CUSTOM" ? "#fff" : "rgba(240,242,255,0.55)",
                    transition: "all 0.15s"
                  }}
                >
                  Custom Domain
                </button>
              </div>

              {/* Inputs */}
              {modalDomainType === "SUBDOMAIN" ? (
                <div>
                  <label htmlFor="modal-subdomain" style={{ fontSize: "0.78rem", fontWeight: 600, color: "rgba(240,242,255,0.65)" }}>Configure Subdomain</label>
                  <div style={{ display: "flex", marginTop: "0.35rem" }}>
                    <input
                      id="modal-subdomain"
                      type="text"
                      placeholder="my-landing-page"
                      value={modalSubdomainPrefix}
                      onChange={(e) => setModalSubdomainPrefix(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                      className="field-input"
                      style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0, flex: 1 }}
                    />
                    <span style={{
                      background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                      borderLeft: "none", borderTopRightRadius: 8, borderBottomRightRadius: 8,
                      display: "flex", alignItems: "center", padding: "0 0.65rem", fontSize: "0.75rem",
                      color: "rgba(240,242,255,0.45)", fontWeight: 550
                    }}>
                      .{baseDomain === "localhost" ? "localhost" : baseDomain}
                    </span>
                  </div>
                </div>
              ) : (
                <div>
                  <label htmlFor="modal-custom" style={{ fontSize: "0.78rem", fontWeight: 600, color: "rgba(240,242,255,0.65)" }}>Custom Domain Name</label>
                  <input
                    id="modal-custom"
                    type="text"
                    placeholder="landing.mybrand.com"
                    value={modalCustomDomain}
                    onChange={(e) => setModalCustomDomain(e.target.value.toLowerCase().trim())}
                    className="field-input"
                    style={{ marginTop: "0.35rem" }}
                  />
                  <div style={{
                    marginTop: "0.6rem", padding: "0.6rem", background: "rgba(139,92,246,0.04)",
                    border: "1px solid rgba(139,92,246,0.12)", borderRadius: 8, fontSize: "0.72rem",
                    color: "rgba(240,242,255,0.65)", lineHeight: 1.35
                  }}>
                    Configure a CNAME record mapping your domain to <code style={{ color: "var(--brand)" }}>{baseDomain}</code>.
                  </div>
                </div>
              )}

              {modalError && (
                <p style={{ fontSize: "0.78rem", color: "#f87171", margin: 0 }}>
                  ⚠️ {modalError}
                </p>
              )}

              {modalSuccess && (
                <p style={{ fontSize: "0.78rem", color: "#34d399", margin: 0 }}>
                  ✓ {modalSuccess}
                </p>
              )}

              {/* Action buttons */}
              <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.5rem" }}>
                <button
                  type="button"
                  onClick={() => setShowPublishModal(false)}
                  className="btn-secondary"
                  style={{ flex: 1, padding: "0.6rem" }}
                >
                  Skip for now
                </button>
                <button
                  type="submit"
                  disabled={modalIsSubmitting}
                  className="btn-primary"
                  style={{ flex: 1, padding: "0.6rem", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.4rem" }}
                >
                  {modalIsSubmitting && <span className="spinner" style={{ width: 11, height: 11 }} />}
                  {modalIsSubmitting ? "Publishing…" : "Publish Live"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
