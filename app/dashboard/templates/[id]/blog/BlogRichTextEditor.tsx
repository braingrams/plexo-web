"use client";

import { useEditor, EditorContent, NodeViewWrapper, ReactNodeViewRenderer, type Editor, type NodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import ImageExtension from "@tiptap/extension-image";
import LinkExtension from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import { useEffect, useState } from "react";
import { SlashCommand } from "./slashCommand/SlashCommand";
import { insertImageWithUpload } from "./insertImageWithUpload";

const TOOLBAR_BUTTON_STYLE = (active: boolean): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  minWidth: 30, height: 30, padding: "0 6px", borderRadius: 6, border: "none", cursor: "pointer",
  fontSize: "0.8rem", fontWeight: 700,
  background: active ? "var(--brand-subtle)" : "transparent",
  color: active ? "var(--brand)" : "rgba(240,242,255,0.7)",
});

function ToolbarButton({ onClick, active, label, children }: { onClick: () => void; active?: boolean; label: string; children: React.ReactNode }) {
  return (
    <button type="button" title={label} onClick={onClick} style={TOOLBAR_BUTTON_STYLE(Boolean(active))}>
      {children}
    </button>
  );
}

/* ─── Icons ─────────────────────────────────── */
function IconBulletList() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="4" cy="6" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="4" cy="18" r="1.4" fill="currentColor" stroke="none" />
      <line x1="9" y1="6" x2="20" y2="6" />
      <line x1="9" y1="12" x2="20" y2="12" />
      <line x1="9" y1="18" x2="20" y2="18" />
    </svg>
  );
}

function IconOrderedList() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="10" y1="6" x2="20" y2="6" />
      <line x1="10" y1="12" x2="20" y2="12" />
      <line x1="10" y1="18" x2="20" y2="18" />
      <text x="1.5" y="8.5" fontSize="7" fontWeight="700" fill="currentColor" stroke="none">1</text>
      <text x="1.5" y="14.5" fontSize="7" fontWeight="700" fill="currentColor" stroke="none">2</text>
      <text x="1.5" y="20.5" fontSize="7" fontWeight="700" fill="currentColor" stroke="none">3</text>
    </svg>
  );
}

function IconQuote() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M7 7c-2.5 0-4.5 2-4.5 4.5S4.5 16 7 16h.5v3H4a1 1 0 0 1-1-1v-3c0-4 2-7 6-8z" />
      <path d="M17 7c-2.5 0-4.5 2-4.5 4.5S14.5 16 17 16h.5v3H14a1 1 0 0 1-1-1v-3c0-4 2-7 6-8z" />
    </svg>
  );
}

function IconAlignLeft() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="15" y2="12" />
      <line x1="3" y1="18" x2="17" y2="18" />
    </svg>
  );
}

function IconAlignCenter() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="7" y1="12" x2="17" y2="12" />
      <line x1="5" y1="18" x2="19" y2="18" />
    </svg>
  );
}

function IconAlignRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="9" y1="12" x2="21" y2="12" />
      <line x1="7" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function IconUndo() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 14 4 9 9 4" />
      <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
    </svg>
  );
}

function IconRedo() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 4 20 9 15 14" />
      <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
    </svg>
  );
}

/* ─── Link modal (replaces window.prompt) ────── */
function LinkModal({ initialValue, hasLink, onSubmit, onRemove, onClose }: {
  initialValue: string;
  hasLink: boolean;
  onSubmit: (url: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(5,6,12,0.7)", backdropFilter: "blur(4px)",
        display: "grid", placeItems: "center", zIndex: 200, padding: "1rem",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(380px, 100%)", background: "rgba(16,18,28,0.98)",
          border: "1px solid rgba(255,255,255,0.09)", borderRadius: 16,
          padding: "1.25rem", boxShadow: "0 30px 80px -20px rgba(0,0,0,0.7)",
        }}
      >
        <p style={{ fontSize: "0.85rem", fontWeight: 700, color: "#f0f2ff", marginBottom: "0.75rem" }}>Link</p>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSubmit(value); } if (e.key === "Escape") onClose(); }}
          placeholder="https://"
          style={{
            width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 10, color: "#f0f2ff", padding: "0.6rem 0.8rem", fontSize: "0.85rem",
            outline: "none", fontFamily: "inherit", marginBottom: "1rem",
          }}
        />
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          {hasLink && (
            <button
              type="button"
              onClick={onRemove}
              style={{ padding: "0.55rem 0.9rem", borderRadius: 9, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)", color: "#f87171", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600, fontFamily: "inherit" }}
            >
              Remove link
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            style={{ padding: "0.55rem 0.9rem", borderRadius: 9, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "rgba(240,242,255,0.65)", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600, fontFamily: "inherit" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSubmit(value)}
            style={{ padding: "0.55rem 1rem", borderRadius: 9, border: "none", background: "linear-gradient(135deg,var(--brand),var(--brand-deep))", color: "#fff", cursor: "pointer", fontSize: "0.8rem", fontWeight: 700, fontFamily: "inherit" }}
          >
            Set link
          </button>
        </div>
      </div>
    </div>
  );
}

function Toolbar({ editor, onUploadFile }: { editor: Editor; onUploadFile: (file: File) => Promise<string | null> }) {
  const [linkModalOpen, setLinkModalOpen] = useState(false);

  return (
    <div
      style={{
        display: "flex", flexWrap: "wrap", gap: "0.2rem", padding: "0.5rem",
        borderBottom: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)",
      }}
    >
      <ToolbarButton label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>B</ToolbarButton>
      <ToolbarButton label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></ToolbarButton>
      <ToolbarButton label="Strikethrough" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></ToolbarButton>
      <ToolbarButton label="Inline code" active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}>{"</>"}</ToolbarButton>
      <span style={{ width: 1, background: "rgba(255,255,255,0.1)", margin: "4px 4px" }} />
      <ToolbarButton label="Heading 1" active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>H1</ToolbarButton>
      <ToolbarButton label="Heading 2" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</ToolbarButton>
      <ToolbarButton label="Heading 3" active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</ToolbarButton>
      <span style={{ width: 1, background: "rgba(255,255,255,0.1)", margin: "4px 4px" }} />
      <ToolbarButton label="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}><IconBulletList /></ToolbarButton>
      <ToolbarButton label="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}><IconOrderedList /></ToolbarButton>
      <ToolbarButton label="Quote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}><IconQuote /></ToolbarButton>
      <ToolbarButton label="Code block" active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>{"{ }"}</ToolbarButton>
      <span style={{ width: 1, background: "rgba(255,255,255,0.1)", margin: "4px 4px" }} />
      <ToolbarButton label="Align left" active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()}><IconAlignLeft /></ToolbarButton>
      <ToolbarButton label="Align center" active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}><IconAlignCenter /></ToolbarButton>
      <ToolbarButton label="Align right" active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()}><IconAlignRight /></ToolbarButton>
      <span style={{ width: 1, background: "rgba(255,255,255,0.1)", margin: "4px 4px" }} />
      <ToolbarButton label="Link" active={editor.isActive("link")} onClick={() => setLinkModalOpen(true)}>Link</ToolbarButton>
      <ToolbarButton label="Insert image" onClick={() => insertImageWithUpload(editor, onUploadFile)}>Image</ToolbarButton>
      <span style={{ flex: 1 }} />
      <ToolbarButton label="Undo" onClick={() => editor.chain().focus().undo().run()}><IconUndo /></ToolbarButton>
      <ToolbarButton label="Redo" onClick={() => editor.chain().focus().redo().run()}><IconRedo /></ToolbarButton>

      {linkModalOpen && (
        <LinkModal
          initialValue={(editor.getAttributes("link").href as string | undefined) ?? "https://"}
          hasLink={editor.isActive("link")}
          onClose={() => setLinkModalOpen(false)}
          onSubmit={(url) => {
            if (url.trim()) {
              editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
            }
            setLinkModalOpen(false);
          }}
          onRemove={() => {
            editor.chain().focus().extendMarkRange("link").unsetLink().run();
            setLinkModalOpen(false);
          }}
        />
      )}
    </div>
  );
}

/* ─── Uploadable image node — shows a spinner overlay in place while its upload resolves ── */
function ImageNodeView({ node }: NodeViewProps) {
  const { src, alt, uploading } = node.attrs as { src: string; alt?: string; uploading?: boolean };
  return (
    <NodeViewWrapper style={{ display: "inline-block", position: "relative", maxWidth: "100%", lineHeight: 0 }}>
      <img
        src={src}
        alt={alt ?? ""}
        style={{ maxWidth: "100%", borderRadius: 8, display: "block", opacity: uploading ? 0.5 : 1, filter: uploading ? "blur(1px)" : "none" }}
      />
      {uploading && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
          <div className="plexo-editor-upload-spinner" />
        </div>
      )}
    </NodeViewWrapper>
  );
}

const UploadableImage = ImageExtension.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      uploading: { default: false, rendered: false },
      uploadId: { default: null, rendered: false },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView);
  },
});

export function BlogRichTextEditor({
  initialContent,
  onChange,
  onUploadFile,
  applyContentSignal,
}: {
  initialContent: unknown;
  onChange: (json: unknown, html: string) => void;
  onUploadFile: (file: File) => Promise<string | null>;
  /** Bump `nonce` to push new HTML into the already-mounted editor from outside (e.g. "AI
   * write for me" replacing the draft) — changing `initialContent` alone wouldn't do
   * anything since Tiptap only reads it once, at mount. */
  applyContentSignal?: { html: string; nonce: number } | null;
}) {
  const editor = useEditor({
    extensions: [
      // StarterKit registers its own default Link extension; a second, separately
      // configured LinkExtension below would otherwise collide with it (Tiptap dedupes by
      // extension name and logs "Duplicate extension names found: ['link']") — disabled
      // here so the explicitly configured one below is the only one.
      StarterKit.configure({ link: false }),
      UploadableImage.configure({ HTMLAttributes: { loading: "lazy" } }),
      LinkExtension.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: "Start writing your post… (type / for blocks)" }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      SlashCommand.configure({ onUploadFile }),
    ],
    content: (initialContent as object) ?? "",
    immediatelyRender: false,
    onUpdate: ({ editor: e }) => onChange(e.getJSON(), e.getHTML()),
  });

  useEffect(() => () => editor?.destroy(), [editor]);

  useEffect(() => {
    if (editor && applyContentSignal) {
      editor.commands.setContent(applyContentSignal.html);
    }
    // Re-run only when the nonce changes (a new signal), not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, applyContentSignal?.nonce]);

  if (!editor) return null;

  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, overflow: "hidden" }}>
      <Toolbar editor={editor} onUploadFile={onUploadFile} />
      <div style={{ padding: "1.25rem", minHeight: 360 }}>
        <EditorContent editor={editor} className="plexo-editor-prose" />
      </div>
      <style>{`
        .plexo-editor-prose .ProseMirror { outline: none; color: #f0f2ff; font-size: 1rem; line-height: 1.7; }
        .plexo-editor-prose .ProseMirror p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: rgba(240,242,255,0.3); float: left; pointer-events: none; height: 0; }
        .plexo-editor-prose .ProseMirror img { max-width: 100%; border-radius: 8px; }
        .plexo-editor-prose .ProseMirror ul, .plexo-editor-prose .ProseMirror ol { padding-left: 1.5em; margin: 0.75em 0; }
        .plexo-editor-prose .ProseMirror ul { list-style: disc; }
        .plexo-editor-prose .ProseMirror ol { list-style: decimal; }
        .plexo-editor-prose .ProseMirror li { margin: 0.25em 0; }
        .plexo-editor-prose .ProseMirror li p { margin: 0; }
        .plexo-editor-prose .ProseMirror blockquote { border-left: 3px solid var(--brand); margin: 1em 0; padding-left: 1em; color: rgba(240,242,255,0.7); }
        .plexo-editor-prose .ProseMirror pre { background: #0b0f19; padding: 12px; border-radius: 8px; overflow-x: auto; }
        .plexo-editor-prose .ProseMirror code { background: rgba(255,255,255,0.08); padding: 2px 5px; border-radius: 4px; }
        .plexo-editor-prose .ProseMirror pre code { background: none; padding: 0; }
        .plexo-editor-upload-spinner {
          width: 26px; height: 26px; border-radius: 50%;
          border: 3px solid rgba(255,255,255,0.25); border-top-color: #fff;
          animation: plexo-editor-spin 0.7s linear infinite;
        }
        @keyframes plexo-editor-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
