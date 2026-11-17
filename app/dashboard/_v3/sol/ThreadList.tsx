"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brain, Check, Ellipsis, Pencil, Plus, Search, Settings, Share2, Trash2, X } from "lucide-react";
import { Button } from "../ui/Button";
import { clearSolLastConversationCookie, type ConversationSummary } from "../../sol/_components/types";
import { filterConversations, groupConversationsByDay } from "./logic";
import { ShareDialog } from "./ShareDialog";

// The last-known list is kept for the tab so a reload shows it straight away.
const CACHE_KEY = "sol:recentsCache";
function readCache(): ConversationSummary[] | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(CACHE_KEY) ?? "null");
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function when(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso);
  const mins = Math.floor((Date.now() - t.getTime()) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const sameDay = t.toDateString() === new Date().toDateString();
  return sameDay ? t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : t.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Past conversations: search, rename, share, delete — grouped by day. */
export function ThreadList({ activeConversationId, refreshSignal }: { activeConversationId: string | null; refreshSignal?: number }) {
  const router = useRouter();
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cached = readCache();
    if (cached) {
      setItems(cached);
      setLoading(false);
    }
  }, []);

  async function load() {
    try {
      const res = await fetch("/api/v1/sol/conversations");
      if (!res.ok) return;
      const data = (await res.json()) as { conversations: ConversationSummary[] };
      setItems(data.conversations);
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(data.conversations));
      } catch {
        // fine
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [refreshSignal]);

  useEffect(() => {
    if (!menuId) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as Element).closest?.("[data-sol3-menu]")) setMenuId(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenuId(null);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [menuId]);

  const searching = query.trim().length > 0;
  const groups = useMemo(() => groupConversationsByDay(filterConversations(items, query)), [items, query]);

  function newChat() {
    clearSolLastConversationCookie();
    router.push("/dashboard/sol?new=1");
  }
  async function commitRename(id: string) {
    const title = draft.trim();
    setRenamingId(null);
    if (!title) return;
    setItems((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
    const res = await fetch(`/api/v1/sol/conversations/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
    if (res.status === 409) void load();
  }
  async function remove(id: string) {
    setDeletingId(null);
    const wasActive = id === activeConversationId;
    const remaining = items.filter((c) => c.id !== id);
    setItems(remaining);
    await fetch(`/api/v1/sol/conversations/${id}`, { method: "DELETE" }).catch(() => {});
    if (wasActive) router.push(remaining[0] ? `/dashboard/sol/${remaining[0].id}` : "/dashboard/sol?new=1");
  }

  return (
    <aside className="sol3-list" aria-label="Your conversations">
      <div className="sol3-list__head">
        <h2 className="sol3-list__title">Conversations</h2>
        <Button fullWidth leftIcon={<Plus size={18} aria-hidden />} onClick={newChat}>
          New chat
        </Button>
        <label className="sol3-search">
          <Search size={17} aria-hidden />
          <span className="plx-sr-only">Search your conversations</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your chats" autoComplete="off" />
          {searching ? (
            <button type="button" className="plx-iconbtn" style={{ width: 28, height: 28 }} aria-label="Clear search" onClick={() => setQuery("")}>
              <X size={15} aria-hidden />
            </button>
          ) : null}
        </label>
      </div>

      <div className="sol3-list__scroll" ref={listRef}>
        {loading ? (
          <>
            <div className="sol3-skel" />
            <div className="sol3-skel" />
            <div className="sol3-skel" />
          </>
        ) : groups.length === 0 ? (
          <p className="sol3-list__empty">{searching ? `No chats match “${query.trim()}”.` : "Your conversations will show up here. Start one and SOL will remember it for you."}</p>
        ) : (
          groups.map((g) => (
            <div key={g.id} style={{ display: "contents" }}>
              <div className="sol3-group">{g.label}</div>
              {g.items.map((c) => {
                const active = c.id === activeConversationId;
                const title = c.title || "New conversation";
                if (renamingId === c.id) {
                  return (
                    <div key={c.id} className="sol3-row">
                      <div className="sol3-row__edit">
                        <input
                          autoFocus
                          aria-label="Conversation name"
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void commitRename(c.id);
                            if (e.key === "Escape") setRenamingId(null);
                          }}
                        />
                        <button type="button" className="plx-iconbtn" style={{ width: 38, height: 38 }} aria-label="Save name" onClick={() => void commitRename(c.id)}>
                          <Check size={17} aria-hidden />
                        </button>
                      </div>
                    </div>
                  );
                }
                if (deletingId === c.id) {
                  return (
                    <div key={c.id} className="sol3-row">
                      <div className="sol3-row__ask">
                        <span>Delete this chat?</span>
                        <Button size="sm" variant="danger" onClick={() => void remove(c.id)}>
                          Delete
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeletingId(null)}>
                          Keep
                        </Button>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={c.id} className="sol3-row" data-active={active} data-menu={menuId === c.id ? "open" : undefined} data-sol3-menu>
                    <Link href={`/dashboard/sol/${c.id}`} className="sol3-row__link" aria-current={active ? "page" : undefined}>
                      <span className="sol3-row__title">{title}</span>
                      <span className="sol3-row__time">{when(c.lastMessageAt ?? c.updatedAt)}</span>
                    </Link>
                    <button type="button" className="plx-iconbtn sol3-row__more" aria-label={`Options for ${title}`} aria-haspopup="menu" aria-expanded={menuId === c.id} onClick={() => setMenuId(menuId === c.id ? null : c.id)}>
                      <Ellipsis size={18} aria-hidden />
                    </button>
                    {menuId === c.id ? (
                      <div className="sol3-pop" role="menu">
                        <button type="button" role="menuitem" onClick={() => { setMenuId(null); setDraft(c.title ?? ""); setRenamingId(c.id); }}>
                          <Pencil size={17} aria-hidden /> Rename
                        </button>
                        <button type="button" role="menuitem" onClick={() => { setMenuId(null); setSharingId(c.id); }}>
                          <Share2 size={17} aria-hidden /> Share
                        </button>
                        <button type="button" role="menuitem" data-danger="true" onClick={() => { setMenuId(null); setDeletingId(c.id); }}>
                          <Trash2 size={17} aria-hidden /> Delete
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      <div className="sol3-list__foot">
        <Link href="/dashboard/sol/memory">
          <Brain size={17} aria-hidden /> Memory
        </Link>
        <Link href="/dashboard/sol/settings">
          <Settings size={17} aria-hidden /> Settings
        </Link>
      </div>
      <ShareDialog conversationId={sharingId} onClose={() => setSharingId(null)} />
    </aside>
  );
}
