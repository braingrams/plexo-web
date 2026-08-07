"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PageContainer } from "../../../_components/PageContainer";

type PostRow = {
  id: string;
  title: string;
  slug: string;
  status: "DRAFT" | "SCHEDULED" | "PUBLISHED" | "ARCHIVED";
  effectiveStatus: "DRAFT" | "SCHEDULED" | "PUBLISHED" | "ARCHIVED";
  publishedAt: string | null;
  updatedAt: string;
  viewCount: number;
  featuredImageUrl: string | null;
  author: { name: string } | null;
};

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  DRAFT: { bg: "rgba(255,255,255,0.08)", color: "rgba(240,242,255,0.65)" },
  SCHEDULED: { bg: "rgba(245,158,11,0.15)", color: "#f59e0b" },
  PUBLISHED: { bg: "rgba(34,197,94,0.15)", color: "#4ade80" },
  ARCHIVED: { bg: "rgba(239,68,68,0.12)", color: "#f87171" },
};

function StatusBadge({ status }: { status: string }) {
  const colors = STATUS_COLORS[status] ?? STATUS_COLORS.DRAFT;
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", padding: "0.2rem 0.6rem", borderRadius: 999,
        fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em",
        background: colors.bg, color: colors.color,
      }}
    >
      {status}
    </span>
  );
}

export function BlogListClient({
  templateId,
  templateName,
  blogEnabled: initialBlogEnabled,
  posts: initialPosts,
}: {
  templateId: string;
  templateName: string;
  blogEnabled: boolean;
  posts: PostRow[];
}) {
  const router = useRouter();
  const [blogEnabled, setBlogEnabled] = useState(initialBlogEnabled);
  const [posts, setPosts] = useState(initialPosts);
  const [enabling, setEnabling] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleEnableBlog() {
    setEnabling(true);
    try {
      const res = await fetch(`/api/blog/${templateId}/site`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      });
      if (res.ok) setBlogEnabled(true);
    } finally {
      setEnabling(false);
    }
  }

  async function handleDelete(post: PostRow) {
    if (!confirm(`Delete "${post.title}"? This can't be undone.`)) return;
    setDeletingId(post.id);
    try {
      const res = await fetch(`/api/blog/${templateId}/posts/${post.id}`, { method: "DELETE" });
      if (res.ok) setPosts((prev) => prev.filter((p) => p.id !== post.id));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <PageContainer>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#f0f2ff", marginBottom: "0.25rem" }}>Blog</h1>
          <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.5)" }}>{templateName}</p>
        </div>
        <div className="blog-actions-row">
          <Link
            href={`/dashboard/templates/${templateId}/blog/import`}
            style={{
              display: "inline-flex", alignItems: "center", padding: "0.6rem 1.1rem", borderRadius: 8,
              fontSize: "0.85rem", fontWeight: 600, color: "rgba(240,242,255,0.8)",
              border: "1px solid rgba(255,255,255,0.12)", textDecoration: "none",
            }}
          >
            Import from WordPress
          </Link>
          <Link
            href={`/dashboard/templates/${templateId}/blog/comments`}
            style={{
              display: "inline-flex", alignItems: "center", padding: "0.6rem 1.1rem", borderRadius: 8,
              fontSize: "0.85rem", fontWeight: 600, color: "rgba(240,242,255,0.8)",
              border: "1px solid rgba(255,255,255,0.12)", textDecoration: "none",
            }}
          >
            Comments
          </Link>
          <Link
            href={`/dashboard/templates/${templateId}/blog/settings`}
            style={{
              display: "inline-flex", alignItems: "center", padding: "0.6rem 1.1rem", borderRadius: 8,
              fontSize: "0.85rem", fontWeight: 600, color: "rgba(240,242,255,0.8)",
              border: "1px solid rgba(255,255,255,0.12)", textDecoration: "none",
            }}
          >
            Settings
          </Link>
          <button
            type="button"
            onClick={() => router.push(`/dashboard/templates/${templateId}/blog/new`)}
            style={{
              display: "inline-flex", alignItems: "center", padding: "0.6rem 1.1rem", borderRadius: 8,
              border: "none", cursor: "pointer", fontSize: "0.85rem", fontWeight: 700,
              background: "var(--brand)", color: "#fff",
            }}
          >
            New Post
          </button>
        </div>
      </div>

      {!blogEnabled && (
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem",
            padding: "0.9rem 1.1rem", borderRadius: 10, marginBottom: "1.5rem",
            background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)",
          }}
        >
          <span style={{ fontSize: "0.85rem", color: "#f59e0b" }}>
            Your blog isn&apos;t live yet — visitors can&apos;t see it at <code>/blog</code> until you turn it on.
          </span>
          <button
            type="button"
            onClick={handleEnableBlog}
            disabled={enabling}
            style={{
              padding: "0.45rem 0.9rem", borderRadius: 8, border: "none", cursor: "pointer",
              fontSize: "0.8rem", fontWeight: 700, background: "#f59e0b", color: "#1a1300",
              whiteSpace: "nowrap",
            }}
          >
            {enabling ? "Enabling…" : "Enable Blog"}
          </button>
        </div>
      )}

      {posts.length === 0 ? (
        <div style={{ textAlign: "center", padding: "4rem 1rem", color: "rgba(240,242,255,0.4)" }}>
          <p style={{ marginBottom: "1rem" }}>No posts yet.</p>
          <button
            type="button"
            onClick={() => router.push(`/dashboard/templates/${templateId}/blog/new`)}
            style={{
              padding: "0.6rem 1.2rem", borderRadius: 8, border: "none", cursor: "pointer",
              fontSize: "0.85rem", fontWeight: 700, background: "var(--brand)", color: "#fff",
            }}
          >
            Write your first post
          </button>
        </div>
      ) : (
        <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, overflow: "hidden" }}>
          {posts.map((post, i) => (
            <div
              key={post.id}
              style={{
                display: "flex", alignItems: "center", gap: "1rem", padding: "0.9rem 1.1rem",
                borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <div
                style={{
                  width: 48, height: 48, borderRadius: 8, background: "rgba(255,255,255,0.05)",
                  backgroundImage: post.featuredImageUrl ? `url(${post.featuredImageUrl})` : undefined,
                  backgroundSize: "cover", backgroundPosition: "center", flexShrink: 0,
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Link
                  href={`/dashboard/templates/${templateId}/blog/${post.id}`}
                  style={{ fontSize: "0.9rem", fontWeight: 600, color: "#f0f2ff", textDecoration: "none" }}
                >
                  {post.title}
                </Link>
                <p style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.4)", marginTop: "0.15rem" }}>
                  {post.author?.name ?? "No author"} · Updated {new Date(post.updatedAt).toLocaleDateString()} · {post.viewCount} views
                </p>
              </div>
              <StatusBadge status={post.effectiveStatus} />
              <button
                type="button"
                onClick={() => handleDelete(post)}
                disabled={deletingId === post.id}
                style={{
                  padding: "0.4rem 0.7rem", borderRadius: 6, border: "1px solid rgba(239,68,68,0.25)",
                  background: "rgba(239,68,68,0.1)", color: "#f87171", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600,
                }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
