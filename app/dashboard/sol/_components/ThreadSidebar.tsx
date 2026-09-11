"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, MessageSquarePlus, Pencil, Trash2, X } from "lucide-react";
import type { ConversationSummary } from "./types";

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ThreadSidebar({
  activeConversationId,
  refreshSignal,
}: {
  activeConversationId: string | null;
  refreshSignal?: number;
}) {
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  async function loadConversations() {
    try {
      const res = await fetch("/api/v1/sol/conversations");
      if (!res.ok) return;
      const data = (await res.json()) as { conversations: ConversationSummary[] };
      setConversations(data.conversations);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  async function handleNewChat() {
    setCreating(true);
    try {
      const res = await fetch("/api/v1/sol/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      if (!res.ok) return;
      const data = (await res.json()) as { conversation: ConversationSummary };
      router.push(`/dashboard/sol/${data.conversation.id}`);
    } finally {
      setCreating(false);
    }
  }

  async function commitRename(id: string) {
    const title = draftTitle.trim();
    setRenamingId(null);
    if (!title) return;
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
    const res = await fetch(`/api/v1/sol/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (res.status === 409) void loadConversations();
  }

  async function handleDelete(id: string) {
    setConfirmingDeleteId(null);
    const wasActive = id === activeConversationId;
    setConversations((prev) => prev.filter((c) => c.id !== id));
    await fetch(`/api/v1/sol/conversations/${id}`, { method: "DELETE" }).catch(() => {});
    if (wasActive) {
      const remaining = conversations.filter((c) => c.id !== id);
      router.push(remaining[0] ? `/dashboard/sol/${remaining[0].id}` : "/dashboard/sol");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: 260, borderRight: "1px solid rgba(255,255,255,0.06)", background: "rgba(8,5,13,0.6)" }}>
      <div style={{ padding: "0.85rem" }}>
        <button
          type="button"
          onClick={() => void handleNewChat()}
          disabled={creating}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.45rem",
            padding: "0.6rem 0.8rem",
            borderRadius: 11,
            border: "1px solid rgba(168,85,247,0.3)",
            background: "linear-gradient(135deg, rgba(168,85,247,0.16), rgba(124,58,237,0.1))",
            color: "#f3e8ff",
            fontSize: "0.83rem",
            fontWeight: 700,
            cursor: creating ? "not-allowed" : "pointer",
            fontFamily: "inherit",
          }}
        >
          <MessageSquarePlus size={15} />
          New chat
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0 0.6rem 0.85rem", display: "flex", flexDirection: "column", gap: "0.15rem" }}>
        {loading && <p style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.35)", padding: "0.5rem 0.6rem" }}>Loading…</p>}
        {!loading && conversations.length === 0 && <p style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.35)", padding: "0.5rem 0.6rem" }}>No conversations yet.</p>}

        {conversations.map((conv) => {
          const isActive = conv.id === activeConversationId;
          const isRenaming = renamingId === conv.id;
          const isConfirmingDelete = confirmingDeleteId === conv.id;
          return (
            <div
              key={conv.id}
              onClick={() => !isRenaming && router.push(`/dashboard/sol/${conv.id}`)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.55rem 0.6rem",
                borderRadius: 10,
                background: isActive ? "rgba(168,85,247,0.14)" : "transparent",
                cursor: isRenaming ? "default" : "pointer",
              }}
              className="sol-thread-row"
            >
              {isRenaming ? (
                <>
                  <input
                    autoFocus
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void commitRename(conv.id);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      background: "rgba(255,255,255,0.06)",
                      border: "1px solid rgba(168,85,247,0.4)",
                      borderRadius: 6,
                      padding: "0.25rem 0.4rem",
                      color: "#f0f2ff",
                      fontSize: "0.8rem",
                      fontFamily: "inherit",
                    }}
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void commitRename(conv.id);
                    }}
                    style={{ background: "none", border: "none", color: "#34d399", cursor: "pointer", padding: 2, flexShrink: 0 }}
                  >
                    <Check size={13} />
                  </button>
                </>
              ) : isConfirmingDelete ? (
                <>
                  <span style={{ flex: 1, fontSize: "0.76rem", color: "#f87171", fontWeight: 600 }}>Delete this chat?</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDelete(conv.id);
                    }}
                    style={{ background: "rgba(248,113,113,0.15)", border: "none", borderRadius: 6, color: "#f87171", fontSize: "0.7rem", fontWeight: 700, padding: "0.2rem 0.5rem", cursor: "pointer" }}
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmingDeleteId(null);
                    }}
                    style={{ background: "none", border: "none", color: "rgba(240,242,255,0.4)", cursor: "pointer", padding: 2, flexShrink: 0 }}
                  >
                    <X size={13} />
                  </button>
                </>
              ) : (
                <>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p
                      style={{
                        fontSize: "0.82rem",
                        fontWeight: isActive ? 700 : 500,
                        color: isActive ? "#f3e8ff" : "rgba(240,242,255,0.75)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {conv.title || "New conversation"}
                    </p>
                    <p style={{ fontSize: "0.68rem", color: "rgba(240,242,255,0.35)" }}>{relativeTime(conv.lastMessageAt ?? conv.updatedAt)}</p>
                  </div>
                  <div className="sol-thread-row-actions" style={{ display: "flex", alignItems: "center", gap: "0.1rem", flexShrink: 0 }}>
                    <button
                      type="button"
                      aria-label="Rename"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDraftTitle(conv.title ?? "");
                        setRenamingId(conv.id);
                      }}
                      style={{ background: "none", border: "none", color: "rgba(240,242,255,0.35)", cursor: "pointer", padding: 4, display: "flex" }}
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      aria-label="Delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmingDeleteId(conv.id);
                      }}
                      style={{ background: "none", border: "none", color: "rgba(240,242,255,0.35)", cursor: "pointer", padding: 4, display: "flex" }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
