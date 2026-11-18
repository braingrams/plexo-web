"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PageContainer } from "../../../_components/PageContainer";
import { UpgradeModal } from "../../../_components/UpgradeModal";
import { Pagination } from "../../../_components/Pagination";
import { paginate } from "@/lib/pagination";
import { formatPublishedQuotaLabel } from "@/lib/blog/publishQuotaLabel";

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
  DRAFT: { bg: "var(--ed-w-080)", color: "var(--ed-t-650)" },
  SCHEDULED: { bg: "color-mix(in srgb, var(--ed-amber) 15%, transparent)", color: "var(--ed-amber)" },
  PUBLISHED: { bg: "color-mix(in srgb, var(--ed-success) 15%, transparent)", color: "var(--ed-success)" },
  ARCHIVED: { bg: "color-mix(in srgb, var(--ed-danger) 12%, transparent)", color: "var(--ed-danger)" },
};

function StatusBadge({ status }: { status: string }) {
  const colors = STATUS_COLORS[status] ?? STATUS_COLORS.DRAFT;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "0.2rem 0.6rem",
        borderRadius: 999,
        fontSize: "0.72rem",
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        background: colors.bg,
        color: colors.color,
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
  publishedCount,
  publishedLimit,
  plan,
}: {
  templateId: string;
  templateName: string;
  blogEnabled: boolean;
  posts: PostRow[];
  publishedCount: number;
  publishedLimit: number | null;
  plan: string;
}) {
  const router = useRouter();
  const [blogEnabled, setBlogEnabled] = useState(initialBlogEnabled);
  const [posts, setPosts] = useState(initialPosts);
  const [paging, setPaging] = useState({ page: 1, pageSize: 25 });
  const shown = paginate(posts, paging);
  const [enabling, setEnabling] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const quotaReached =
    publishedLimit !== null && publishedCount >= publishedLimit;

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
      const res = await fetch(`/api/blog/${templateId}/posts/${post.id}`, {
        method: "DELETE",
      });
      if (res.ok) setPosts((prev) => prev.filter((p) => p.id !== post.id));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <PageContainer>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "1rem",
          marginBottom: "1.5rem",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: "1.5rem",
              fontWeight: 800,
              color: "var(--ed-text)",
              marginBottom: "0.25rem",
            }}
          >
            Blog
          </h1>
          <p style={{ fontSize: "0.85rem", color: "var(--ed-t-500)" }}>
            {templateName}
          </p>
          <p
            style={{
              fontSize: "0.78rem",
              color: quotaReached ? "var(--ed-amber)" : "var(--ed-t-400)",
              marginTop: "0.3rem",
            }}
          >
            {formatPublishedQuotaLabel(publishedCount, publishedLimit)}
            {quotaReached && (
              <button
                type="button"
                onClick={() => setShowUpgradeModal(true)}
                style={{
                  marginLeft: "0.5rem",
                  background: "none",
                  border: "none",
                  color: "var(--ed-accent-text)",
                  cursor: "pointer",
                  fontSize: "0.78rem",
                  fontWeight: 700,
                  textDecoration: "underline",
                  padding: 0,
                }}
              >
                Upgrade
              </button>
            )}
          </p>
        </div>
        <div className="blog-actions-row">
          <Link
            href={`/dashboard/templates/${templateId}/blog/import`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "0.6rem 1.1rem",
              borderRadius: 8,
              fontSize: "0.85rem",
              fontWeight: 600,
              color: "var(--ed-t-800)",
              border: "1px solid var(--ed-w-120)",
              textDecoration: "none",
            }}
          >
            Import from WordPress
          </Link>
          <Link
            href={`/dashboard/templates/${templateId}/blog/comments`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "0.6rem 1.1rem",
              borderRadius: 8,
              fontSize: "0.85rem",
              fontWeight: 600,
              color: "var(--ed-t-800)",
              border: "1px solid var(--ed-w-120)",
              textDecoration: "none",
            }}
          >
            Comments
          </Link>
          <Link
            href={`/dashboard/templates/${templateId}/blog/settings`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "0.6rem 1.1rem",
              borderRadius: 8,
              fontSize: "0.85rem",
              fontWeight: 600,
              color: "var(--ed-t-800)",
              border: "1px solid var(--ed-w-120)",
              textDecoration: "none",
            }}
          >
            Settings
          </Link>
          <button
            type="button"
            onClick={() =>
              router.push(`/dashboard/templates/${templateId}/blog/new`)
            }
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "0.6rem 1.1rem",
              borderRadius: 8,
              border: "none",
              cursor: "pointer",
              fontSize: "0.85rem",
              fontWeight: 700,
              background: "var(--brand)",
              color: "var(--ed-on-brand)",
            }}
          >
            New Post
          </button>
        </div>
      </div>

      {!blogEnabled && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1rem",
            padding: "0.9rem 1.1rem",
            borderRadius: 10,
            marginBottom: "1.5rem",
            background: "color-mix(in srgb, var(--ed-amber) 8%, transparent)",
            border: "1px solid color-mix(in srgb, var(--ed-amber) 25%, transparent)",
          }}
        >
          <span style={{ fontSize: "0.85rem", color: "var(--ed-amber)" }}>
            Your blog isn&apos;t live yet — visitors can&apos;t see it at{" "}
            <code>/blog</code> until you turn it on.
          </span>
          <button
            type="button"
            onClick={handleEnableBlog}
            disabled={enabling}
            style={{
              padding: "0.45rem 0.9rem",
              borderRadius: 8,
              border: "none",
              cursor: "pointer",
              fontSize: "0.8rem",
              fontWeight: 700,
              background: "var(--ed-amber)",
              color: "var(--ed-on-brand)",
              whiteSpace: "nowrap",
            }}
          >
            {enabling ? "Enabling…" : "Enable Blog"}
          </button>
        </div>
      )}

      {posts.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "4rem 1rem",
            color: "var(--ed-t-400)",
          }}
        >
          <p style={{ marginBottom: "1rem" }}>No posts yet.</p>
          <button
            type="button"
            onClick={() =>
              router.push(`/dashboard/templates/${templateId}/blog/new`)
            }
            style={{
              padding: "0.6rem 1.2rem",
              borderRadius: 8,
              border: "none",
              cursor: "pointer",
              fontSize: "0.85rem",
              fontWeight: 700,
              background: "var(--brand)",
              color: "var(--ed-on-brand)",
            }}
          >
            Write your first post
          </button>
        </div>
      ) : (
        <>
        <div
          style={{
            border: "1px solid var(--ed-w-080)",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          {shown.items.map((post, i) => (
            <div
              key={post.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "1rem",
                padding: "0.9rem 1.1rem",
                borderTop:
                  i === 0 ? "none" : "1px solid var(--ed-w-060)",
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 8,
                  background: "var(--ed-w-050)",
                  backgroundImage: post.featuredImageUrl
                    ? `url(${post.featuredImageUrl})`
                    : undefined,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Link
                  href={`/dashboard/templates/${templateId}/blog/${post.id}`}
                  style={{
                    fontSize: "0.9rem",
                    fontWeight: 600,
                    color: "var(--ed-text)",
                    textDecoration: "none",
                  }}
                >
                  {post.title}
                </Link>
                <p
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--ed-t-400)",
                    marginTop: "0.15rem",
                  }}
                >
                  {post.author?.name ?? "No author"} · Updated{" "}
                  {new Date(post.updatedAt).toLocaleDateString()} ·{" "}
                  {post.viewCount} views
                </p>
              </div>
              <StatusBadge status={post.effectiveStatus} />
              <button
                type="button"
                onClick={() => handleDelete(post)}
                disabled={deletingId === post.id}
                style={{
                  padding: "0.4rem 0.7rem",
                  borderRadius: 6,
                  border: "1px solid color-mix(in srgb, var(--ed-danger) 25%, transparent)",
                  background: "color-mix(in srgb, var(--ed-danger) 10%, transparent)",
                  color: "var(--ed-danger)",
                  cursor: "pointer",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
        <Pagination page={shown.page} pageSize={shown.pageSize} total={shown.total} noun="posts" onChange={setPaging} />
        </>
      )}

      <UpgradeModal
        open={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        title={publishedLimit ? "Published post limit reached" : "Publishing a blog is part of Starter"}
        message={
          publishedLimit
            ? `Your plan allows ${publishedLimit} published blog posts on this site. Upgrade for unlimited posts.`
            : "Your posts are saved. Upgrade to Starter to publish your blog — with unlimited posts — alongside a full multi-page site."
        }
        targetPlan={plan === "FREE" ? "STARTER" : "PRO"}
        returnTo={`/dashboard/templates/${templateId}/blog`}
      />
    </PageContainer>
  );
}
