"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Brain, Check, MessageSquarePlus, Pencil, Search, Settings, Trash2, X } from "lucide-react";
import { SolAccountFooter } from "./SolAccountFooter";
import { exitSolToPlexo } from "./SolModeSwitch";
import { registerSolReadinessTask, resolveSolReadinessTask } from "./solReadinessGate";
import { clearSolLastConversationCookie, type ConversationSummary } from "./types";

// A hard browser reload fully remounts this component (unlike navigating between SOL's own
// routes, which keeps the layout — and this sidebar — mounted), so it always started from
// an empty list and a "Loading…" row while it re-fetched. Caching the last-known list in
// sessionStorage (survives a reload, cleared only when the tab actually closes) lets it
// render the same Recents list immediately instead of a blank moment first — the real fetch
// still runs the same as before and silently corrects anything stale once it resolves.
const RECENTS_CACHE_KEY = "sol:recentsCache";

function readCachedConversations(): ConversationSummary[] | null {
  try {
    const raw = sessionStorage.getItem(RECENTS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeCachedConversations(conversations: ConversationSummary[]): void {
  try {
    sessionStorage.setItem(RECENTS_CACHE_KEY, JSON.stringify(conversations));
  } catch {
    // Locked-down storage (private mode, etc.) — just means the next reload starts from
    // the loading state again, never worth failing over.
  }
}

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
  organizationName,
}: {
  activeConversationId: string | null;
  refreshSignal?: number;
  organizationName: string;
}) {
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationSummary[]>(() => readCachedConversations() ?? []);
  const [loading, setLoading] = useState(() => readCachedConversations() === null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const visibleConversations = useMemo(() => {
    // Used to also hide any conversation with `messageCount === 0` here, to keep a stray
    // empty row (from the old eager-create-on-"New chat" behavior) out of Recents. Removed
    // deliberately: messageCount is a derived, cached counter (recomputed by
    // bumpConversationActivity after a turn settles, not the actual source of truth), and a
    // real bug in exactly when that recompute ran left a genuine 5-message conversation
    // stuck at messageCount 0 — permanently invisible in Recents, with no way back to it
    // short of knowing its raw URL. History should never silently disappear because of a
    // bookkeeping counter drifting out of sync with reality, and conversations are only
    // ever created lazily on an actual first send now (see SolChatView's ensureConversation)
    // — a truly message-less row reaching here at all is already a rare edge case, not the
    // common one this filter was originally guarding against.
    if (!searchOpen || !searchQuery.trim()) return conversations;
    const q = searchQuery.trim().toLowerCase();
    return conversations.filter((c) => (c.title || "New conversation").toLowerCase().includes(q));
  }, [conversations, searchOpen, searchQuery]);

  async function loadConversations() {
    try {
      const res = await fetch("/api/v1/sol/conversations");
      if (!res.ok) return;
      const data = (await res.json()) as { conversations: ConversationSummary[] };
      setConversations(data.conversations);
      writeCachedConversations(data.conversations);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Tells the entrance overlay (see solReadinessGate.ts) "the Recents list is a real
    // dependency, don't reveal the page until this has settled" — registered before the
    // fetch starts, resolved once it settles either way, so a failed fetch can't hang the
    // overlay open forever.
    registerSolReadinessTask("sidebar");
    void loadConversations().finally(() => resolveSolReadinessTask("sidebar"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  function handleNewChat() {
    // Deliberately does NOT create a SolConversation row here — a conversation is only
    // ever created lazily, on the first actual message sent (see SolChatView's
    // ensureConversation), the same way ChatGPT/Claude.ai's own "New chat" never creates
    // a thread just from clicking it. `?new=1` tells /dashboard/sol's index page to render
    // the blank composer unconditionally instead of its normal "resume the most recent
    // conversation" landing behavior — otherwise, once any real conversation exists, this
    // would just bounce straight back into it instead of ever showing a blank composer.
    //
    // Also clears the "last conversation" session cookie — without this, the CURRENT view
    // goes blank but the cookie still points at the conversation you just left, so the next
    // time SOL is opened (even later in this same session) it would resume that one right
    // back instead of staying on a fresh chat.
    clearSolLastConversationCookie();
    router.push("/dashboard/sol?new=1");
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

  const navItemStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    width: "100%",
    padding: "0.5rem 0.6rem",
    borderRadius: 9,
    border: "none",
    background: "none",
    color: "rgba(240,242,255,0.72)",
    fontSize: "0.83rem",
    fontWeight: 600,
    fontFamily: "inherit",
    cursor: "pointer",
    textDecoration: "none",
    textAlign: "left",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: 260, borderRight: "1px solid rgba(255,255,255,0.06)", background: "rgba(8,5,13,0.6)" }}>
      {/* Plexo brand mark — SOL still lives inside Plexo, so its own sidebar keeps that
          identity up top rather than only branding itself as "SOL". Padding/border match
          SolHeader's own strip exactly (a fixed, identical height — matching padding alone
          isn't enough since the two rows' content isn't the same intrinsic size) so the two
          read as one continuous top bar across the sidebar and the header, not two
          separately-sized pieces of chrome bolted together. */}
      {/* A plain <Link> here would land on /dashboard just long enough to get bounced
          straight back into /dashboard/sol — see exitSolToPlexo's own comment for why
          leaving SOL always has to save preferredSurface="DASHBOARD" first. */}
      <button
        type="button"
        onClick={() => void exitSolToPlexo(router)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.55rem",
          height: 61,
          width: "100%",
          boxSizing: "border-box",
          padding: "0 1rem",
          borderTop: "none",
          borderLeft: "none",
          borderRight: "none",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          background: "none",
          textDecoration: "none",
          cursor: "pointer",
          fontFamily: "inherit",
          textAlign: "left",
        }}
      >
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: 7,
            background: "linear-gradient(135deg,var(--brand),var(--brand-deeper))",
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L4 7v5c0 4.97 3.35 9.63 8 10.93C17.65 21.63 21 16.97 21 12V7L12 2z" fill="white" opacity="0.95" />
          </svg>
        </div>
        <span style={{ fontFamily: "var(--font-heading), sans-serif", fontWeight: 700, fontSize: "0.92rem", color: "#f0f2ff", letterSpacing: "-0.01em" }}>Plexo</span>
      </button>

      <div style={{ padding: "0.3rem 0.6rem 0.6rem", display: "flex", flexDirection: "column", gap: "0.15rem" }}>
        <button type="button" onClick={handleNewChat} style={navItemStyle} className="sol-nav-item">
          <MessageSquarePlus size={16} />
          New chat
        </button>

        <button type="button" onClick={() => setSearchOpen((v) => !v)} style={navItemStyle} className="sol-nav-item">
          <Search size={16} />
          Search chats
        </button>

        {searchOpen && (
          <input
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search your chats…"
            style={{
              margin: "0.1rem 0.1rem 0.3rem",
              padding: "0.4rem 0.6rem",
              borderRadius: 8,
              border: "1px solid rgba(var(--brand-rgb),0.3)",
              background: "rgba(255,255,255,0.05)",
              color: "#f0f2ff",
              fontSize: "0.8rem",
              fontFamily: "inherit",
              outline: "none",
            }}
          />
        )}

        <Link href="/dashboard/sol/memory" style={navItemStyle} className="sol-nav-item">
          <Brain size={16} />
          Memory
        </Link>

        <Link href="/dashboard/sol/settings" style={navItemStyle} className="sol-nav-item">
          <Settings size={16} />
          Sol settings
        </Link>
      </div>

      <div style={{ padding: "0.4rem 0.85rem 0.35rem", fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "rgba(240,242,255,0.3)" }}>
        Recents
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0 0.6rem 0.85rem", display: "flex", flexDirection: "column", gap: "0.15rem" }}>
        {loading && <p style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.35)", padding: "0.5rem 0.6rem" }}>Loading…</p>}
        {!loading && visibleConversations.length === 0 && (!searchOpen || !searchQuery.trim()) && (
          <p style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.35)", padding: "0.5rem 0.6rem" }}>No conversations yet.</p>
        )}
        {!loading && searchOpen && searchQuery.trim() && visibleConversations.length === 0 && (
          <p style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.35)", padding: "0.5rem 0.6rem" }}>No chats match &ldquo;{searchQuery}&rdquo;.</p>
        )}

        {visibleConversations.map((conv) => {
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
                background: isActive ? "rgba(var(--brand-rgb),0.14)" : "transparent",
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
                      border: "1px solid rgba(var(--brand-rgb),0.4)",
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

      <SolAccountFooter organizationName={organizationName} />

      <style>{`
        .sol-nav-item:hover { background: rgba(255,255,255,0.05); color: #f0f2ff; }
      `}</style>
    </div>
  );
}
