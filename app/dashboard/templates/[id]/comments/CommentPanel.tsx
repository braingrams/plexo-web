"use client";

import { useMemo, useState } from "react";

import { Avatar } from "@/app/dashboard/_components/Avatar";
import { CommentBody } from "./CommentBody";
import { MentionComposer } from "./MentionComposer";
import type { CommentItem } from "./useComments";

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function Thread({
  root,
  replies,
  currentUserId,
  canResolve,
  canDeleteAny,
  highlighted,
  onResolve,
  onRemove,
  onReply,
}: {
  root: CommentItem;
  replies: CommentItem[];
  currentUserId: string;
  canResolve: boolean;
  canDeleteAny: boolean;
  highlighted: boolean;
  onResolve: (id: string, resolved: boolean) => void;
  onRemove: (id: string) => void;
  onReply: (parentId: string, body: string) => Promise<void>;
}) {
  const [replying, setReplying] = useState(false);

  return (
    <div
      id={`comment-thread-${root.id}`}
      style={{
        borderRadius: 12,
        padding: "0.75rem",
        marginBottom: "0.6rem",
        background: highlighted ? "rgba(139,92,246,0.1)" : "rgba(255,255,255,0.03)",
        border: highlighted ? "1px solid rgba(139,92,246,0.35)" : "1px solid transparent",
        transition: "background 0.2s, border-color 0.2s",
        opacity: root.resolved ? 0.6 : 1,
      }}
    >
      {[root, ...replies].map((c, i) => (
        <div key={c.id} style={{ display: "flex", gap: "0.55rem", marginTop: i === 0 ? 0 : "0.65rem", marginLeft: i === 0 ? 0 : "1.2rem" }}>
          <Avatar name={c.author.name} size={26} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: "0.4rem" }}>
              <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#f0f2ff" }}>{c.author.name}</span>
              <span style={{ fontSize: "0.68rem", color: "rgba(240,242,255,0.35)" }}>{timeAgo(c.createdAt)}</span>
            </div>
            <p style={{ fontSize: "0.82rem", color: c.deleted ? "rgba(240,242,255,0.35)" : "rgba(240,242,255,0.85)", lineHeight: 1.5, fontStyle: c.deleted ? "italic" : "normal" }}>
              {c.deleted ? "Comment deleted" : <CommentBody body={c.body} />}
            </p>
            {!c.deleted && (c.author.id === currentUserId || canDeleteAny) && (
              <button
                onClick={() => onRemove(c.id)}
                style={{ background: "none", border: "none", color: "rgba(240,242,255,0.35)", fontSize: "0.68rem", cursor: "pointer", padding: 0, marginTop: 2 }}
              >
                Delete
              </button>
            )}
          </div>
        </div>
      ))}

      <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.6rem", marginLeft: "1.2rem" }}>
        {!replying && (
          <button
            onClick={() => setReplying(true)}
            style={{ background: "none", border: "none", color: "var(--brand)", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer" }}
          >
            Reply
          </button>
        )}
        {canResolve && (
          <button
            onClick={() => onResolve(root.id, !root.resolved)}
            style={{ background: "none", border: "none", color: "rgba(240,242,255,0.5)", fontSize: "0.75rem", cursor: "pointer" }}
          >
            {root.resolved ? "Reopen" : "Resolve"}
          </button>
        )}
      </div>

      {replying && (
        <div style={{ marginTop: "0.5rem", marginLeft: "1.2rem" }}>
          <MentionComposer
            placeholder="Reply…"
            autoFocus
            submitLabel="Reply"
            onCancel={() => setReplying(false)}
            onSubmit={async (body) => {
              await onReply(root.id, body);
              setReplying(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

export function CommentPanel({
  comments,
  currentUserId,
  currentUserRole,
  highlightedId,
  onResolve,
  onRemove,
  onReply,
  onClose,
}: {
  comments: CommentItem[];
  currentUserId: string;
  currentUserRole: string;
  highlightedId: string | null;
  onResolve: (id: string, resolved: boolean) => void;
  onRemove: (id: string) => void;
  onReply: (parentId: string, body: string) => Promise<void>;
  onClose: () => void;
}) {
  const [showResolved, setShowResolved] = useState(false);
  const canResolve = currentUserRole === "owner" || currentUserRole === "admin" || currentUserRole === "editor" || currentUserRole === "commenter";
  const canDeleteAny = currentUserRole === "owner" || currentUserRole === "admin";

  const threads = useMemo(() => {
    const roots = comments.filter((c) => !c.parentId);
    const byParent = new Map<string, CommentItem[]>();
    for (const c of comments) {
      if (!c.parentId) continue;
      const list = byParent.get(c.parentId) ?? [];
      list.push(c);
      byParent.set(c.parentId, list);
    }
    return roots
      .filter((r) => showResolved || !r.resolved)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((root) => ({ root, replies: byParent.get(root.id) ?? [] }));
  }, [comments, showResolved]);

  return (
    <div
      style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 340, zIndex: 90,
        background: "rgba(13,15,26,0.98)", borderLeft: "1px solid rgba(255,255,255,0.09)",
        backdropFilter: "blur(20px)", display: "flex", flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1rem 1rem 0.75rem", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <h2 style={{ fontSize: "0.95rem", fontWeight: 700, color: "#f0f2ff" }}>Comments</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <button
            onClick={() => setShowResolved((v) => !v)}
            style={{ background: "none", border: "none", color: "rgba(240,242,255,0.45)", fontSize: "0.72rem", cursor: "pointer" }}
          >
            {showResolved ? "Hide resolved" : "Show resolved"}
          </button>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(240,242,255,0.5)", cursor: "pointer", fontSize: "1rem" }}>
            ✕
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0.85rem" }}>
        {threads.length === 0 && (
          <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.35)", textAlign: "center", marginTop: "2rem" }}>
            No comments yet. Click anywhere on the canvas to leave one.
          </p>
        )}
        {threads.map(({ root, replies }) => (
          <Thread
            key={root.id}
            root={root}
            replies={replies}
            currentUserId={currentUserId}
            canResolve={canResolve}
            canDeleteAny={canDeleteAny}
            highlighted={highlightedId === root.id}
            onResolve={onResolve}
            onRemove={onRemove}
            onReply={onReply}
          />
        ))}
      </div>
    </div>
  );
}
