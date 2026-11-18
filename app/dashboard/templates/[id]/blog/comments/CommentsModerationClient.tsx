"use client";

import { useState } from "react";
import Link from "next/link";
import { PageContainer } from "../../../../_components/PageContainer";
import { Pagination } from "../../../../_components/Pagination";
import { paginate } from "@/lib/pagination";

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
  PENDING: { bg: "color-mix(in srgb, var(--ed-amber) 15%, transparent)", color: "var(--ed-amber)" },
  APPROVED: { bg: "color-mix(in srgb, var(--ed-success) 15%, transparent)", color: "var(--ed-success)" },
  SPAM: { bg: "color-mix(in srgb, var(--ed-danger) 12%, transparent)", color: "var(--ed-danger)" },
  REJECTED: { bg: "var(--ed-w-080)", color: "var(--ed-t-500)" },
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

  const [paging, setPaging] = useState({ page: 1, pageSize: 25 });
  const filtered = tab === "ALL" ? comments : comments.filter((c) => c.status === tab);
  // Every comment is loaded; they are shown a page at a time (moderating the last one on a page moves you back a page).
  const shown = paginate(filtered, paging);
  const visible = shown.items;
  const counts = comments.reduce<Record<string, number>>((acc, c) => { acc[c.status] = (acc[c.status] ?? 0) + 1; return acc; }, {});

  return (
    <PageContainer>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "var(--ed-text)", marginBottom: "1.5rem" }}>Comments</h1>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => { setTab(t.value); setPaging((p) => ({ ...p, page: 1 })); }}
            style={{
              padding: "0.4rem 0.9rem", borderRadius: 8, border: "1px solid var(--ed-w-120)", cursor: "pointer",
              fontSize: "0.8rem", fontWeight: 700,
              background: tab === t.value ? "var(--brand-subtle)" : "transparent",
              color: tab === t.value ? "var(--ed-accent-text)" : "var(--ed-t-600)",
            }}
          >
            {t.label}
            {t.value !== "ALL" && counts[t.value] ? ` (${counts[t.value]})` : ""}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p style={{ textAlign: "center", color: "var(--ed-t-400)", padding: "3rem 1rem" }}>No comments here.</p>
      ) : (
        <>
        <div style={{ border: "1px solid var(--ed-w-080)", borderRadius: 12, overflow: "hidden" }}>
          {visible.map((c, i) => {
            const colors = STATUS_COLORS[c.status];
            return (
              <div key={c.id} style={{ padding: "1rem 1.1rem", borderTop: i === 0 ? "none" : "1px solid var(--ed-w-060)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                    <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--ed-text)" }}>{c.authorName}</span>
                    <span style={{ fontSize: "0.75rem", color: "var(--ed-t-400)" }}>{c.authorEmail}</span>
                    <span style={{ display: "inline-flex", padding: "0.15rem 0.55rem", borderRadius: 999, fontSize: "0.68rem", fontWeight: 700, textTransform: "uppercase", background: colors.bg, color: colors.color }}>
                      {c.status}
                    </span>
                  </div>
                  <span style={{ fontSize: "0.72rem", color: "var(--ed-t-350)" }}>{new Date(c.createdAt).toLocaleString()}</span>
                </div>
                <p style={{ fontSize: "0.85rem", color: "var(--ed-t-850)", lineHeight: 1.5, marginBottom: "0.6rem" }} dangerouslySetInnerHTML={{ __html: c.body }} />
                <p style={{ fontSize: "0.75rem", color: "var(--ed-t-400)", marginBottom: "0.7rem" }}>
                  On <Link href={`/dashboard/templates/${templateId}/blog/${c.post.id}`} style={{ color: "var(--ed-accent-text)" }}>{c.post.title}</Link>
                  {c.parentId ? " · reply" : ""}
                </p>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  {c.status !== "APPROVED" && (
                    <button type="button" disabled={busyId === c.id} onClick={() => updateStatus(c.id, "APPROVED")} style={{ padding: "0.35rem 0.7rem", borderRadius: 6, border: "1px solid color-mix(in srgb, var(--ed-success) 30%, transparent)", background: "color-mix(in srgb, var(--ed-success) 10%, transparent)", color: "var(--ed-success)", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer" }}>
                      Approve
                    </button>
                  )}
                  {c.status !== "REJECTED" && (
                    <button type="button" disabled={busyId === c.id} onClick={() => updateStatus(c.id, "REJECTED")} style={{ padding: "0.35rem 0.7rem", borderRadius: 6, border: "1px solid var(--ed-w-120)", background: "transparent", color: "var(--ed-t-600)", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer" }}>
                      Reject
                    </button>
                  )}
                  {c.status !== "SPAM" && (
                    <button type="button" disabled={busyId === c.id} onClick={() => updateStatus(c.id, "SPAM")} style={{ padding: "0.35rem 0.7rem", borderRadius: 6, border: "1px solid color-mix(in srgb, var(--ed-danger) 25%, transparent)", background: "color-mix(in srgb, var(--ed-danger) 8%, transparent)", color: "var(--ed-danger)", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer" }}>
                      Mark Spam
                    </button>
                  )}
                  <button type="button" disabled={busyId === c.id} onClick={() => handleDelete(c.id)} style={{ padding: "0.35rem 0.7rem", borderRadius: 6, border: "none", background: "transparent", color: "var(--ed-danger)", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer", marginLeft: "auto" }}>
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <Pagination page={shown.page} pageSize={shown.pageSize} total={shown.total} noun="comments" onChange={setPaging} />
        </>
      )}
    </PageContainer>
  );
}
