"use client";

import { useState } from "react";
import Link from "next/link";

type Status = "PENDING" | "APPROVED" | "SPAM" | "REJECTED";

type Comment = {
  id: string;
  authorName: string;
  authorEmail: string;
  body: string;
  status: Status;
  createdAt: string;
  parentId: string | null;
  post: { id: string; title: string; slug: string };
};

const TABS: { value: Status | "ALL"; label: string }[] = [
  { value: "PENDING", label: "Pending" },
  { value: "APPROVED", label: "Approved" },
  { value: "SPAM", label: "Spam" },
  { value: "REJECTED", label: "Rejected" },
  { value: "ALL", label: "All" },
];

const STATUS_COLORS: Record<Status, { bg: string; color: string }> = {
  PENDING: { bg: "rgba(245,158,11,0.15)", color: "#f59e0b" },
  APPROVED: { bg: "rgba(34,197,94,0.15)", color: "#4ade80" },
  SPAM: { bg: "rgba(239,68,68,0.12)", color: "#f87171" },
  REJECTED: { bg: "rgba(255,255,255,0.08)", color: "rgba(240,242,255,0.5)" },
};

export function CommentsModerationClient({ templateId, initialComments }: { templateId: string; initialComments: Comment[] }) {
  const [comments, setComments] = useState(initialComments);
  const [tab, setTab] = useState<Status | "ALL">("PENDING");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function updateStatus(id: string, status: Status) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/blog/${templateId}/comments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        setComments((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)));
      }
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this comment (and any replies to it)? This can't be undone.")) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/blog/${templateId}/comments/${id}`, { method: "DELETE" });
      if (res.ok) setComments((prev) => prev.filter((c) => c.id !== id));
    } finally {
      setBusyId(null);
    }
  }

  const visible = tab === "ALL" ? comments : comments.filter((c) => c.status === tab);
  const counts = comments.reduce<Record<string, number>>((acc, c) => { acc[c.status] = (acc[c.status] ?? 0) + 1; return acc; }, {});

  return (
    <div style={{ padding: "2rem", maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#f0f2ff", marginBottom: "1.5rem" }}>Comments</h1>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            style={{
              padding: "0.4rem 0.9rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", cursor: "pointer",
              fontSize: "0.8rem", fontWeight: 700,
              background: tab === t.value ? "var(--brand-subtle)" : "transparent",
              color: tab === t.value ? "var(--brand)" : "rgba(240,242,255,0.6)",
            }}
          >
            {t.label}
            {t.value !== "ALL" && counts[t.value] ? ` (${counts[t.value]})` : ""}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p style={{ textAlign: "center", color: "rgba(240,242,255,0.4)", padding: "3rem 1rem" }}>No comments here.</p>
      ) : (
        <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, overflow: "hidden" }}>
          {visible.map((c, i) => {
            const colors = STATUS_COLORS[c.status];
            return (
              <div key={c.id} style={{ padding: "1rem 1.1rem", borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                    <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "#f0f2ff" }}>{c.authorName}</span>
                    <span style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.4)" }}>{c.authorEmail}</span>
                    <span style={{ display: "inline-flex", padding: "0.15rem 0.55rem", borderRadius: 999, fontSize: "0.68rem", fontWeight: 700, textTransform: "uppercase", background: colors.bg, color: colors.color }}>
                      {c.status}
                    </span>
                  </div>
                  <span style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.35)" }}>{new Date(c.createdAt).toLocaleString()}</span>
                </div>
                <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.85)", lineHeight: 1.5, marginBottom: "0.6rem" }} dangerouslySetInnerHTML={{ __html: c.body }} />
                <p style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.4)", marginBottom: "0.7rem" }}>
                  On <Link href={`/dashboard/templates/${templateId}/blog/${c.post.id}`} style={{ color: "var(--brand)" }}>{c.post.title}</Link>
                  {c.parentId ? " · reply" : ""}
                </p>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  {c.status !== "APPROVED" && (
                    <button type="button" disabled={busyId === c.id} onClick={() => updateStatus(c.id, "APPROVED")} style={{ padding: "0.35rem 0.7rem", borderRadius: 6, border: "1px solid rgba(34,197,94,0.3)", background: "rgba(34,197,94,0.1)", color: "#4ade80", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer" }}>
                      Approve
                    </button>
                  )}
                  {c.status !== "REJECTED" && (
                    <button type="button" disabled={busyId === c.id} onClick={() => updateStatus(c.id, "REJECTED")} style={{ padding: "0.35rem 0.7rem", borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "rgba(240,242,255,0.6)", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer" }}>
                      Reject
                    </button>
                  )}
                  {c.status !== "SPAM" && (
                    <button type="button" disabled={busyId === c.id} onClick={() => updateStatus(c.id, "SPAM")} style={{ padding: "0.35rem 0.7rem", borderRadius: 6, border: "1px solid rgba(239,68,68,0.25)", background: "rgba(239,68,68,0.08)", color: "#f87171", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer" }}>
                      Mark Spam
                    </button>
                  )}
                  <button type="button" disabled={busyId === c.id} onClick={() => handleDelete(c.id)} style={{ padding: "0.35rem 0.7rem", borderRadius: 6, border: "none", background: "transparent", color: "#f87171", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer", marginLeft: "auto" }}>
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
