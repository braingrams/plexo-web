"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BlogRichTextEditor } from "./BlogRichTextEditor";
import { AiWriteAssistant, type AiBlogPostResult } from "./AiWriteAssistant";
import { computeSeoChecklist } from "./seoChecklist";
import { PageContainer } from "../../../_components/PageContainer";
import { CustomSelect } from "../../../../_components/CustomSelect";

type Status = "DRAFT" | "SCHEDULED" | "PUBLISHED" | "ARCHIVED";

type Category = { id: string; name: string; slug: string };
type Tag = { id: string; name: string; slug: string };
type Author = { id: string; name: string };

export type InitialPost = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  contentJson: unknown;
  featuredImageUrl: string | null;
  featuredImageAlt: string | null;
  status: Status;
  scheduledAt: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  ogImageUrl: string | null;
  noindex: boolean;
  authorId: string | null;
  categoryIds: string[];
  tagNames: string[];
};

const FIELD_LABEL: React.CSSProperties = { fontSize: "0.75rem", fontWeight: 700, color: "rgba(240,242,255,0.5)", textTransform: "uppercase", letterSpacing: "0.04em", display: "block", marginBottom: "0.4rem" };
const FIELD_INPUT: React.CSSProperties = { width: "100%", padding: "0.55rem 0.7rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.03)", color: "#f0f2ff", fontSize: "0.85rem", fontFamily: "inherit" };
const PANEL: React.CSSProperties = { border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "1rem", marginBottom: "1rem", background: "rgba(255,255,255,0.02)" };

function slugifyClient(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-");
}

function IconCheck() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function IconWarning() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

export function BlogPostEditor({
  templateId,
  initialPost,
  categories,
  tags: initialTags,
  authors: initialAuthors,
  currentUserAuthorId,
  siteDomain,
}: {
  templateId: string;
  initialPost: InitialPost | null;
  categories: Category[];
  tags: Tag[];
  authors: Author[];
  /** BlogAuthor row linked to the signed-in user — the default for a brand-new post. An
   * existing post keeps whatever author it already has saved regardless of this. */
  currentUserAuthorId: string;
  siteDomain: string | null;
}) {
  const router = useRouter();
  const [postId, setPostId] = useState<string | null>(initialPost?.id ?? null);
  const [title, setTitle] = useState(initialPost?.title ?? "");
  const [slug, setSlug] = useState(initialPost?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(initialPost));
  const [editingSlug, setEditingSlug] = useState(false);
  const [excerpt, setExcerpt] = useState(initialPost?.excerpt ?? "");
  const [contentJson, setContentJson] = useState<unknown>(initialPost?.contentJson ?? null);
  const [contentHtml, setContentHtml] = useState("");
  const [featuredImageUrl, setFeaturedImageUrl] = useState(initialPost?.featuredImageUrl ?? "");
  const [featuredImageAlt, setFeaturedImageAlt] = useState(initialPost?.featuredImageAlt ?? "");
  // Drives the loading slot in the Featured Image panel — shared between a manual upload
  // and (later) the AI "write for me" image-generation step, just with a different label.
  const [featuredImageStatus, setFeaturedImageStatus] = useState<"uploading" | "generating" | null>(null);
  const [showImageUrlInput, setShowImageUrlInput] = useState(false);
  const [imageUrlDraft, setImageUrlDraft] = useState("");
  const [imageUrlError, setImageUrlError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(initialPost?.status ?? "DRAFT");
  const [scheduledAt, setScheduledAt] = useState(initialPost?.scheduledAt?.slice(0, 16) ?? "");
  const [metaTitle, setMetaTitle] = useState(initialPost?.metaTitle ?? "");
  const [metaDescription, setMetaDescription] = useState(initialPost?.metaDescription ?? "");
  const [noindex, setNoindex] = useState(initialPost?.noindex ?? false);
  const [authorId, setAuthorId] = useState(initialPost?.authorId || currentUserAuthorId || "");
  const [categoryIds, setCategoryIds] = useState<string[]>(initialPost?.categoryIds ?? []);
  const [tagNames, setTagNames] = useState<string[]>(initialPost?.tagNames ?? []);
  const [tagInput, setTagInput] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [allCategories, setAllCategories] = useState(categories);
  const [allTags, setAllTags] = useState(initialTags);
  const [allAuthors, setAllAuthors] = useState(initialAuthors);
  const [newAuthorName, setNewAuthorName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  // Bumping the nonce pushes new HTML into the already-mounted rich text editor — see
  // BlogRichTextEditor's applyContentSignal prop.
  const [contentSignal, setContentSignal] = useState<{ html: string; nonce: number } | null>(null);
  const [aiImageError, setAiImageError] = useState<string | null>(null);

  const markDirty = useCallback(() => setDirty(true), []);

  useEffect(() => {
    if (!slugTouched) setSlug(slugifyClient(title));
  }, [title, slugTouched]);

  async function resolveTagIds(): Promise<string[]> {
    const ids: string[] = [];
    for (const name of tagNames) {
      const existing = allTags.find((t) => t.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        ids.push(existing.id);
        continue;
      }
      const res = await fetch(`/api/blog/${templateId}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const { tag } = await res.json();
        setAllTags((prev) => [...prev, tag]);
        ids.push(tag.id);
      }
    }
    return ids;
  }

  const save = useCallback(
    async (overrideStatus?: Status) => {
      setSaving(true);
      setError(null);
      try {
        const tagIds = await resolveTagIds();
        const payload = {
          // Never blocks on a missing title — matches WordPress's own autosave-as-draft
          // behavior (an untitled draft still saves, so nothing typed is ever lost).
          title: title.trim() || "Untitled",
          slug,
          excerpt,
          contentJson: contentJson ?? { type: "doc", content: [{ type: "paragraph" }] },
          contentHtml,
          featuredImageUrl: featuredImageUrl || null,
          featuredImageAlt: featuredImageAlt || null,
          status: overrideStatus ?? status,
          scheduledAt: (overrideStatus ?? status) === "SCHEDULED" && scheduledAt ? new Date(scheduledAt).toISOString() : null,
          metaTitle: metaTitle || null,
          metaDescription: metaDescription || null,
          noindex,
          authorId: authorId || null,
          categoryIds,
          tagIds,
        };

        const res = await fetch(
          postId ? `/api/blog/${templateId}/posts/${postId}` : `/api/blog/${templateId}/posts`,
          {
            method: postId ? "PATCH" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error ?? "Couldn't save. Try again.");
          return null;
        }
        const { post } = await res.json();
        if (overrideStatus) setStatus(overrideStatus);
        setDirty(false);
        setLastSavedAt(new Date());
        if (!postId) {
          setPostId(post.id);
          router.replace(`/dashboard/templates/${templateId}/blog/${post.id}`);
        }
        return post;
      } finally {
        setSaving(false);
      }
    },
    [title, slug, excerpt, contentJson, contentHtml, featuredImageUrl, featuredImageAlt, status, scheduledAt, metaTitle, metaDescription, noindex, authorId, categoryIds, tagNames, allTags, postId, templateId, router],
  );

  // Autosave-as-draft — fires from the very first keystroke on a brand-new post (not
  // just after the first manual save), so closing the tab or a crash mid-draft never
  // loses work. Guarded only against saving a completely blank new post (nothing typed
  // anywhere yet), to avoid littering the list with empty "Untitled" drafts.
  const hasSavableContent = title.trim().length > 0 || contentHtml.replace(/<[^>]+>/g, "").trim().length > 0;
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!dirty || !hasSavableContent) return;
    const t = setTimeout(() => saveRef.current(), 5000);
    return () => clearTimeout(t);
  }, [dirty, hasSavableContent]);

  // Best-effort flush on tab close/navigation-away — beforeunload can't await a normal
  // fetch, so this uses keepalive to let the request outlive the page unload.
  useEffect(() => {
    function flush() {
      if (!dirty || !hasSavableContent || !postId) return;
      const payload = { title: title.trim() || "Untitled", contentJson, contentHtml };
      fetch(`/api/blog/${templateId}/posts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
    }
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
    };
  }, [dirty, hasSavableContent, postId, title, contentJson, contentHtml, templateId]);

  async function uploadFile(file: File): Promise<string | null> {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/blog/${templateId}/upload-image`, { method: "POST", body: form });
    if (!res.ok) {
      setError("Image upload failed.");
      return null;
    }
    const { url } = await res.json();
    return url;
  }

  async function handleFeaturedImageUpload(file: File) {
    setFeaturedImageStatus("uploading");
    const url = await uploadFile(file);
    setFeaturedImageStatus(null);
    if (url) {
      setFeaturedImageUrl(url);
      markDirty();
    }
  }

  function handleUseImageUrl() {
    const url = imageUrlDraft.trim();
    if (!url) return;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      setImageUrlError("That doesn't look like a valid URL.");
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      setImageUrlError("Image URL must start with http:// or https://");
      return;
    }
    setFeaturedImageUrl(url);
    setImageUrlDraft("");
    setImageUrlError(null);
    setShowImageUrlInput(false);
    markDirty();
  }

  async function createCategory(name: string): Promise<Category | null> {
    const res = await fetch(`/api/blog/${templateId}/categories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return null;
    const { category } = await res.json();
    setAllCategories((prev) => [...prev, category]);
    return category;
  }

  async function handleAddCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    const category = await createCategory(name);
    if (category) {
      setCategoryIds((prev) => [...prev, category.id]);
      setNewCategoryName("");
      markDirty();
    }
  }

  /** Pure generation — returns the drafted post for the caller to preview. Never touches
   * editor state, so a result the user doesn't like can be regenerated or dismissed
   * without ever having clobbered what was already in the editor (see AiWriteAssistant). */
  async function handleAiGenerate(topic: string): Promise<AiBlogPostResult> {
    const res = await fetch("/api/v1/ai/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": "workspace-internal" },
      body: JSON.stringify({
        mode: "generate_blog_post",
        templateKind: "LANDING_PAGE",
        prompt: topic,
        context: {
          existingCategories: allCategories.map((c) => c.name),
          existingTags: allTags.map((t) => t.name),
        },
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as { error?: string });
      if (res.status === 402) throw new Error("Insufficient AI credits — top up or configure your own API key in Settings.");
      throw new Error(body.error ?? "AI generation failed.");
    }
    const { result } = (await res.json()) as { result: AiBlogPostResult };
    return result;
  }

  /** Applies a previously-generated (and now user-approved) draft to the editor's fields,
   * then kicks off the featured image generation. */
  async function handleAiInsert(result: AiBlogPostResult): Promise<void> {
    setTitle(result.title);
    setExcerpt(result.excerpt);
    setMetaTitle(result.metaTitle);
    setMetaDescription(result.metaDescription);
    setContentHtml(result.contentHtml);
    setContentSignal({ html: result.contentHtml, nonce: Date.now() });
    markDirty();

    const resolvedCategoryIds: string[] = [];
    for (const name of result.categories) {
      const existing = allCategories.find((c) => c.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        resolvedCategoryIds.push(existing.id);
        continue;
      }
      const created = await createCategory(name);
      if (created) resolvedCategoryIds.push(created.id);
    }
    if (resolvedCategoryIds.length > 0) {
      setCategoryIds((prev) => Array.from(new Set([...prev, ...resolvedCategoryIds])));
    }

    if (result.tags.length > 0) {
      setTagNames((prev) => {
        const lower = new Set(prev.map((t) => t.toLowerCase()));
        const merged = [...prev];
        for (const name of result.tags) {
          if (!lower.has(name.toLowerCase())) {
            merged.push(name);
            lower.add(name.toLowerCase());
          }
        }
        return merged;
      });
    }

    // The featured image is generated independently — a failure here (including running
    // out of credit) never discards the text already applied above.
    setAiImageError(null);
    setFeaturedImageStatus("generating");
    try {
      const imageRes = await fetch(`/api/blog/${templateId}/posts/ai-generate-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: result.imagePrompt }),
      });
      if (imageRes.ok) {
        const { url } = await imageRes.json();
        setFeaturedImageUrl(url);
        markDirty();
      } else {
        const body = await imageRes.json().catch(() => ({}) as { error?: string });
        setAiImageError(
          imageRes.status === 402
            ? "Not enough credits for the featured image — you can upload one manually."
            : body.error ?? "Couldn't generate a featured image.",
        );
      }
    } catch {
      setAiImageError("Couldn't generate a featured image.");
    } finally {
      setFeaturedImageStatus(null);
    }
  }

  async function handleAddAuthor() {
    const name = newAuthorName.trim();
    if (!name) return;
    const res = await fetch(`/api/blog/${templateId}/authors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      const { author } = await res.json();
      setAllAuthors((prev) => [...prev, author]);
      setAuthorId(author.id);
      setNewAuthorName("");
      markDirty();
    }
  }

  function addTagFromInput() {
    const name = tagInput.trim().replace(/,$/, "");
    if (name && !tagNames.some((t) => t.toLowerCase() === name.toLowerCase())) {
      setTagNames((prev) => [...prev, name]);
      markDirty();
    }
    setTagInput("");
  }

  const permalink = siteDomain ? `${siteDomain}/blog/${slug || "…"}` : `/blog/${slug || "…"}`;

  return (
    <PageContainer className="blog-editor-grid" style={{ paddingTop: 0 }}>
      <div>
        <AiWriteAssistant onGenerate={handleAiGenerate} onInsert={handleAiInsert} />
        <textarea
          value={title}
          onChange={(e) => { setTitle(e.target.value); markDirty(); }}
          placeholder="Post title"
          rows={1}
          style={{
            width: "100%", fontSize: "1.75rem", fontWeight: 800, color: "#f0f2ff", background: "transparent",
            border: "none", outline: "none", resize: "none", fontFamily: "inherit", marginBottom: "0.4rem",
          }}
        />
        <div style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.45)", marginBottom: "1.25rem" }}>
          Permalink: <span style={{ color: "var(--brand)" }}>{permalink}</span>{" "}
          {editingSlug ? (
            <input
              autoFocus
              value={slug}
              onChange={(e) => { setSlug(slugifyClient(e.target.value)); setSlugTouched(true); markDirty(); }}
              onBlur={() => setEditingSlug(false)}
              style={{ ...FIELD_INPUT, display: "inline", width: 200, padding: "0.2rem 0.4rem" }}
            />
          ) : (
            <button type="button" onClick={() => setEditingSlug(true)} style={{ background: "none", border: "none", color: "var(--brand)", cursor: "pointer", fontSize: "0.8rem", textDecoration: "underline" }}>
              Edit
            </button>
          )}
        </div>

        <BlogRichTextEditor
          initialContent={contentJson}
          onUploadFile={uploadFile}
          applyContentSignal={contentSignal}
          onChange={(json, html) => {
            setContentJson(json);
            setContentHtml(html);
            markDirty();
          }}
        />

        <div style={{ ...PANEL, marginTop: "1.5rem" }}>
          <label style={FIELD_LABEL}>Excerpt</label>
          <textarea
            value={excerpt}
            onChange={(e) => { setExcerpt(e.target.value); markDirty(); }}
            placeholder="A short summary shown on the blog listing (auto-generated if left blank)"
            rows={2}
            style={{ ...FIELD_INPUT, resize: "vertical" }}
          />
        </div>

        <div style={PANEL}>
          <label style={FIELD_LABEL}>SEO</label>
          <div style={{ marginBottom: "0.75rem" }}>
            <input
              value={metaTitle}
              onChange={(e) => { setMetaTitle(e.target.value); markDirty(); }}
              placeholder={title || "Meta title"}
              style={FIELD_INPUT}
              maxLength={70}
            />
            <p style={{ fontSize: "0.7rem", color: "rgba(240,242,255,0.35)", marginTop: "0.2rem" }}>{metaTitle.length}/70</p>
          </div>
          <div style={{ marginBottom: "0.75rem" }}>
            <textarea
              value={metaDescription}
              onChange={(e) => { setMetaDescription(e.target.value); markDirty(); }}
              placeholder={excerpt || "Meta description"}
              rows={2}
              maxLength={160}
              style={{ ...FIELD_INPUT, resize: "vertical" }}
            />
            <p style={{ fontSize: "0.7rem", color: "rgba(240,242,255,0.35)", marginTop: "0.2rem" }}>{metaDescription.length}/160</p>
          </div>
          <div
            style={{
              padding: "0.7rem 0.9rem", borderRadius: 8, background: "#fff", color: "#1a0dab",
              fontFamily: "arial, sans-serif",
            }}
          >
            <div style={{ fontSize: "0.95rem", color: "#1a0dab" }}>{metaTitle || title || "Post title"}</div>
            <div style={{ fontSize: "0.78rem", color: "#006621" }}>{permalink}</div>
            <div style={{ fontSize: "0.8rem", color: "#545454" }}>{metaDescription || excerpt || "Meta description preview…"}</div>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.75rem", fontSize: "0.8rem", color: "rgba(240,242,255,0.7)" }}>
            <input type="checkbox" checked={noindex} onChange={(e) => { setNoindex(e.target.checked); markDirty(); }} />
            Hide from search engines (noindex)
          </label>
        </div>

        <div style={PANEL}>
          <label style={FIELD_LABEL}>SEO Checklist</label>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {computeSeoChecklist({ title, metaTitle, metaDescription, excerpt, featuredImageUrl, featuredImageAlt, contentHtml }).map((item, i) => (
              <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", fontSize: "0.8rem", marginBottom: "0.5rem", color: item.level === "good" ? "#4ade80" : "#f59e0b" }}>
                <span style={{ display: "inline-flex" }}>{item.level === "good" ? <IconCheck /> : <IconWarning />}</span>
                <span style={{ color: "rgba(240,242,255,0.75)" }}>{item.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div>
        <div style={PANEL}>
          <label style={FIELD_LABEL}>Status</label>
          <div style={{ marginBottom: "0.75rem" }}>
            <CustomSelect
              value={status}
              options={[
                { label: "Draft", value: "DRAFT" },
                { label: "Scheduled", value: "SCHEDULED" },
                { label: "Published", value: "PUBLISHED" },
                { label: "Archived", value: "ARCHIVED" },
              ]}
              onChange={(value) => { setStatus(value as Status); markDirty(); }}
            />
          </div>
          {status === "SCHEDULED" && (
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => { setScheduledAt(e.target.value); markDirty(); }}
              style={{ ...FIELD_INPUT, marginBottom: "0.75rem" }}
            />
          )}
          {error && <p style={{ color: "#f87171", fontSize: "0.8rem", marginBottom: "0.5rem" }}>{error}</p>}
          <button
            type="button"
            disabled={saving}
            onClick={() => save(status === "DRAFT" ? "PUBLISHED" : status)}
            style={{
              width: "100%", padding: "0.65rem", borderRadius: 8, border: "none", cursor: "pointer",
              fontSize: "0.85rem", fontWeight: 700, background: "var(--brand)", color: "#fff", marginBottom: "0.5rem",
            }}
          >
            {saving ? "Saving…" : status === "DRAFT" ? "Publish" : "Save"}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => save("DRAFT")}
            style={{
              width: "100%", padding: "0.55rem", borderRadius: 8, cursor: "pointer",
              fontSize: "0.8rem", fontWeight: 600, background: "transparent", color: "rgba(240,242,255,0.6)",
              border: "1px solid rgba(255,255,255,0.12)",
            }}
          >
            Save as Draft
          </button>
          {postId && (
            <a
              href={`/dashboard/templates/${templateId}/blog/${postId}/preview`}
              target="_blank"
              rel="noreferrer"
              style={{ display: "block", textAlign: "center", marginTop: "0.6rem", fontSize: "0.78rem", color: "var(--brand)" }}
            >
              Preview
            </a>
          )}
          {lastSavedAt && <p style={{ textAlign: "center", fontSize: "0.7rem", color: "rgba(240,242,255,0.3)", marginTop: "0.5rem" }}>Saved {lastSavedAt.toLocaleTimeString()}</p>}
        </div>

        <div style={PANEL}>
          <label style={FIELD_LABEL}>Featured Image</label>
          {aiImageError && (
            <p style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.5rem", fontSize: "0.75rem", color: "#f59e0b", marginBottom: "0.5rem" }} role="alert">
              {aiImageError}
              <button type="button" onClick={() => setAiImageError(null)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontWeight: 700, flexShrink: 0 }}>×</button>
            </p>
          )}
          {featuredImageStatus ? (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "0.5rem",
              height: 100, borderRadius: 8, border: "1px dashed rgba(255,255,255,0.2)",
            }}>
              <div style={{
                width: 22, height: 22, borderRadius: "50%",
                border: "3px solid rgba(255,255,255,0.15)", borderTopColor: "var(--brand)",
                animation: "blog-editor-spin 0.7s linear infinite",
              }} />
              <span style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.5)" }}>
                {featuredImageStatus === "uploading" ? "Uploading…" : "Generating image…"}
              </span>
              <style>{`@keyframes blog-editor-spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          ) : featuredImageUrl ? (
            <div style={{ marginBottom: "0.6rem" }}>
              <img src={featuredImageUrl} alt="" style={{ width: "100%", borderRadius: 8, marginBottom: "0.5rem" }} />
              <input
                value={featuredImageAlt}
                onChange={(e) => { setFeaturedImageAlt(e.target.value); markDirty(); }}
                placeholder="Alt text (for SEO & accessibility)"
                style={{ ...FIELD_INPUT, marginBottom: "0.4rem" }}
              />
              <button type="button" onClick={() => { setFeaturedImageUrl(""); markDirty(); }} style={{ fontSize: "0.75rem", color: "#f87171", background: "none", border: "none", cursor: "pointer" }}>
                Remove
              </button>
            </div>
          ) : showImageUrlInput ? (
            <div>
              <div style={{ display: "flex", gap: "0.4rem" }}>
                <input
                  autoFocus
                  value={imageUrlDraft}
                  onChange={(e) => { setImageUrlDraft(e.target.value); setImageUrlError(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleUseImageUrl(); } }}
                  placeholder="https://example.com/image.jpg"
                  style={{ ...FIELD_INPUT, flex: 1 }}
                />
                <button
                  type="button"
                  onClick={handleUseImageUrl}
                  style={{ padding: "0 0.9rem", borderRadius: 8, border: "1px solid var(--brand)", background: "var(--brand-subtle)", color: "var(--brand)", fontSize: "0.8rem", fontWeight: 600, cursor: "pointer" }}
                >
                  Use
                </button>
              </div>
              {imageUrlError && <p style={{ fontSize: "0.72rem", color: "#f87171", marginTop: "0.35rem" }}>{imageUrlError}</p>}
              <button
                type="button"
                onClick={() => { setShowImageUrlInput(false); setImageUrlDraft(""); setImageUrlError(null); }}
                style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.4)", background: "none", border: "none", cursor: "pointer", marginTop: "0.4rem" }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div>
              <label
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", height: 100, borderRadius: 8,
                  border: "1px dashed rgba(255,255,255,0.2)", cursor: "pointer", fontSize: "0.8rem", color: "rgba(240,242,255,0.5)",
                }}
              >
                Click to upload
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFeaturedImageUpload(f); }}
                />
              </label>
              <button
                type="button"
                onClick={() => setShowImageUrlInput(true)}
                style={{ display: "block", width: "100%", textAlign: "center", fontSize: "0.75rem", color: "var(--brand)", background: "none", border: "none", cursor: "pointer", marginTop: "0.5rem" }}
              >
                Or paste an image URL
              </button>
            </div>
          )}
        </div>

        <div style={PANEL}>
          <label style={FIELD_LABEL}>Categories</label>
          {allCategories.map((c) => (
            <label key={c.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.82rem", color: "rgba(240,242,255,0.8)", marginBottom: "0.35rem" }}>
              <input
                type="checkbox"
                checked={categoryIds.includes(c.id)}
                onChange={(e) => {
                  setCategoryIds((prev) => (e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id)));
                  markDirty();
                }}
              />
              {c.name}
            </label>
          ))}
          <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.5rem" }}>
            <input
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddCategory(); } }}
              placeholder="Add new category"
              style={{ ...FIELD_INPUT, fontSize: "0.8rem" }}
            />
          </div>
        </div>

        <div style={PANEL}>
          <label style={FIELD_LABEL}>Tags</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginBottom: "0.5rem" }}>
            {tagNames.map((name) => (
              <span key={name} style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", padding: "0.2rem 0.55rem", borderRadius: 999, background: "var(--brand-subtle)", color: "var(--brand)", fontSize: "0.75rem" }}>
                {name}
                <button type="button" onClick={() => { setTagNames((prev) => prev.filter((t) => t !== name)); markDirty(); }} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontWeight: 700 }}>
                  ×
                </button>
              </span>
            ))}
          </div>
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTagFromInput(); } }}
            placeholder="Add a tag, press Enter"
            style={{ ...FIELD_INPUT, fontSize: "0.8rem" }}
          />
        </div>

        <div style={PANEL}>
          <label style={FIELD_LABEL}>Author</label>
          <div style={{ marginBottom: "0.5rem" }}>
            <CustomSelect
              value={authorId}
              options={[{ label: "No author", value: "" }, ...allAuthors.map((a) => ({ label: a.name, value: a.id }))]}
              onChange={(value) => { setAuthorId(value); markDirty(); }}
            />
          </div>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <input
              value={newAuthorName}
              onChange={(e) => setNewAuthorName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddAuthor(); } }}
              placeholder="Add new author"
              style={{ ...FIELD_INPUT, fontSize: "0.8rem" }}
            />
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
