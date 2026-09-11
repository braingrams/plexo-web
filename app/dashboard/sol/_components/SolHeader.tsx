"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Menu, Pencil, X, Zap } from "lucide-react";
import { ModelTierSelector } from "./ModelTierSelector";
import { ExportMenu } from "./ExportMenu";
import { useSolSidebar } from "./SolSidebarContext";
import type { ConversationSummary, ModelTier } from "./types";

export function SolHeader({
  conversation,
  onRename,
  onModelTierChange,
  creditsRefreshKey,
}: {
  conversation: ConversationSummary | null;
  onRename: (title: string) => void;
  onModelTierChange: (tier: ModelTier) => void;
  creditsRefreshKey?: number;
}) {
  const { openMobileSidebar } = useSolSidebar();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(conversation?.title ?? "");
  const [credits, setCredits] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraftTitle(conversation?.title ?? "");
  }, [conversation?.id, conversation?.title]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    let cancelled = false;
    // Reuses the existing lightweight profile endpoint rather than standing up a new
    // balance-read route — see app/api/v1/profile/route.ts, which already returns
    // allowanceBalance/topupBalance/totalCredits for exactly this purpose.
    fetch("/api/v1/profile")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.user) setCredits(data.user.totalCredits ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [creditsRefreshKey]);

  function commitRename() {
    setEditing(false);
    const trimmed = draftTitle.trim();
    if (trimmed && trimmed !== conversation?.title) onRename(trimmed);
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        padding: "0.85rem 1.25rem",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        background: "rgba(10,7,16,0.55)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}
    >
      <button
        type="button"
        onClick={openMobileSidebar}
        aria-label="Conversations"
        className="sol-mobile-sidebar-toggle"
        style={{ background: "none", border: "none", color: "rgba(240,242,255,0.6)", cursor: "pointer", padding: "0.3rem", borderRadius: 8, display: "none" }}
      >
        <Menu size={16} />
      </button>

      <button
        type="button"
        onClick={() => router.push("/dashboard")}
        aria-label="Back to dashboard"
        title="Back to dashboard"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.35rem",
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 9,
          padding: "0.4rem 0.65rem",
          color: "rgba(240,242,255,0.7)",
          fontSize: "0.78rem",
          fontWeight: 600,
          cursor: "pointer",
          fontFamily: "inherit",
          flexShrink: 0,
        }}
      >
        <ArrowLeft size={14} />
        Dashboard
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", minWidth: 0, flex: 1 }}>
        {editing ? (
          <>
            <input
              ref={inputRef}
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") {
                  setDraftTitle(conversation?.title ?? "");
                  setEditing(false);
                }
              }}
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(168,85,247,0.35)",
                borderRadius: 8,
                padding: "0.3rem 0.6rem",
                color: "#f0f2ff",
                fontSize: "0.88rem",
                fontWeight: 600,
                fontFamily: "inherit",
                minWidth: 0,
                flex: 1,
                maxWidth: 320,
              }}
            />
            <button type="button" onClick={commitRename} aria-label="Save title" style={{ background: "none", border: "none", color: "#34d399", cursor: "pointer", padding: "0.25rem" }}>
              <Check size={15} />
            </button>
            <button
              type="button"
              onClick={() => {
                setDraftTitle(conversation?.title ?? "");
                setEditing(false);
              }}
              aria-label="Cancel"
              style={{ background: "none", border: "none", color: "rgba(240,242,255,0.4)", cursor: "pointer", padding: "0.25rem" }}
            >
              <X size={15} />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => conversation && setEditing(true)}
            disabled={!conversation}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
              background: "none",
              border: "none",
              color: "#f3f0fa",
              fontSize: "0.92rem",
              fontWeight: 700,
              fontFamily: "var(--font-heading), sans-serif",
              cursor: conversation ? "pointer" : "default",
              minWidth: 0,
              maxWidth: "100%",
              padding: "0.2rem 0",
            }}
          >
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{conversation?.title || "New conversation"}</span>
            {conversation && <Pencil size={12} color="rgba(240,242,255,0.35)" style={{ flexShrink: 0 }} />}
          </button>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexShrink: 0 }}>
        {credits !== null && (
          <span
            title="Credit balance"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.3rem",
              padding: "0.3rem 0.65rem",
              borderRadius: 999,
              background: "rgba(168,85,247,0.1)",
              border: "1px solid rgba(168,85,247,0.25)",
              color: "#e9d5ff",
              fontSize: "0.74rem",
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            <Zap size={11} fill="currentColor" />
            {credits.toLocaleString()}
          </span>
        )}

        {conversation && (
          <div style={{ width: 150 }} className="sol-header-model-selector">
            <ModelTierSelector value={conversation.modelTier} onChange={onModelTierChange} />
          </div>
        )}

        {conversation && <ExportMenu conversationId={conversation.id} label="Export conversation" />}
      </div>
    </div>
  );
}
