"use client";

import { useState } from "react";
import { SolGlyph } from "../../../_v3/sol/SolGlyph";
import { SolWriteDrawer } from "../../../_v3/sol/SolWriteDrawer";

export type AiBlogPostResult = {
  title: string;
  excerpt: string;
  contentHtml: string;
  metaTitle: string;
  metaDescription: string;
  categories: string[];
  tags: string[];
  imagePrompt: string;
};

/** SOL's blog-post drawer: the same panel from the blog list and from inside the editor. */
export function BlogSolWriteDrawer({
  open,
  onClose,
  onUse,
  categories = [],
  tags = [],
  siteId,
}: {
  open: boolean;
  onClose: () => void;
  onUse: (result: AiBlogPostResult) => Promise<void>;
  categories?: string[];
  tags?: string[];
  /** The site the post is for, so SOL writes in its brand voice. */
  siteId?: string;
}) {
  return (
    <SolWriteDrawer<AiBlogPostResult>
      open={open}
      onClose={onClose}
      title="Write a post with SOL"
      intro="SOL writes the title, the post, a short summary, search details, categories and tags. You can change every word afterwards."
      placeholder="e.g. 5 ways to get more people to open your emails"
      buildRequest={(prompt) => ({ mode: "generate_blog_post", templateKind: "LANDING_PAGE", prompt, ...(siteId ? { siteId } : {}), context: { existingCategories: categories, existingTags: tags } })}
      parseResult={(raw) => raw as AiBlogPostResult}
      useLabel="Use this post"
      onUse={onUse}
      renderResult={(r) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h3 className="plx-h3" style={{ margin: 0 }}>{r.title}</h3>
          {r.excerpt ? <p className="plx-small" style={{ fontStyle: "italic", margin: 0 }}>{r.excerpt}</p> : null}
          <div
            className="plx-card plx-solpost"
            style={{ maxHeight: "40dvh", overflow: "auto", padding: 14, fontSize: 14, lineHeight: 1.6 }}
            // The model's own post body, shown as it will read; never executed (sanitised on save by the editor).
            dangerouslySetInnerHTML={{ __html: r.contentHtml.replace(/<script[\s\S]*?<\/script>/gi, "") }}
          />
          {r.categories.length || r.tags.length ? (
            <p className="plx-small" style={{ margin: 0 }}>{[...r.categories, ...r.tags.map((t) => `#${t}`)].join("  ·  ")}</p>
          ) : null}
          <p className="plx-small" style={{ margin: 0 }}>A featured picture is made when you use the post.</p>
        </div>
      )}
    />
  );
}

/** The button that opens the drawer, for places that just need a button (the editor's top bar). */
export function AiWriteAssistant({ onInsert, categories, tags }: { onInsert: (result: AiBlogPostResult) => Promise<void>; categories?: string[]; tags?: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem", padding: "0.5rem 0.9rem", borderRadius: 9, border: "1px solid color-mix(in srgb, var(--brand) 30%, transparent)", background: "color-mix(in srgb, var(--brand) 10%, transparent)", color: "var(--ed-accent-text)", cursor: "pointer", fontSize: "0.8rem", fontWeight: 700, fontFamily: "inherit", marginBottom: "1rem" }}
      >
        <SolGlyph size={16} />
        Write with SOL
      </button>
      <BlogSolWriteDrawer open={open} onClose={() => setOpen(false)} onUse={onInsert} categories={categories} tags={tags} />
    </>
  );
}
