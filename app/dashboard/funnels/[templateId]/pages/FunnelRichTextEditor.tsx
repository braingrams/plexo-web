"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import ImageExtension from "@tiptap/extension-image";
import LinkExtension from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect, useState } from "react";
import { insertImageWithUpload } from "@/app/dashboard/templates/[id]/blog/insertImageWithUpload";

const TOOLBAR_BUTTON_STYLE = (active: boolean): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  minWidth: 28, height: 28, padding: "0 5px", borderRadius: 6, border: "none", cursor: "pointer",
  fontSize: "0.78rem", fontWeight: 700,
  background: active ? "rgba(var(--brand-rgb),0.18)" : "transparent",
  color: active ? "var(--brand, #c4b5fd)" : "rgba(240,242,255,0.6)",
});

function ToolbarButton({ onClick, active, label, children }: { onClick: () => void; active?: boolean; label: string; children: React.ReactNode }) {
  return (
    <button type="button" title={label} onClick={onClick} style={TOOLBAR_BUTTON_STYLE(Boolean(active))}>
      {children}
    </button>
  );
}

function LinkModal({ initialValue, hasLink, onSubmit, onRemove, onClose }: {
  initialValue: string; hasLink: boolean; onSubmit: (url: string) => void; onRemove: () => void; onClose: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(5,6,12,0.7)", backdropFilter: "blur(4px)", display: "grid", placeItems: "center", zIndex: 300, padding: "1rem" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(380px, 100%)", background: "rgba(16,18,28,0.98)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 16, padding: "1.25rem", boxShadow: "0 30px 80px -20px rgba(0,0,0,0.7)" }}
      >
        <p style={{ fontSize: "0.85rem", fontWeight: 700, color: "#f0f2ff", marginBottom: "0.75rem" }}>Link</p>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSubmit(value); } if (e.key === "Escape") onClose(); }}
          placeholder="https://"
          style={{ width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, color: "#f0f2ff", padding: "0.6rem 0.8rem", fontSize: "0.85rem", outline: "none", fontFamily: "inherit", marginBottom: "1rem" }}
        />
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          {hasLink && (
            <button type="button" onClick={onRemove} style={{ padding: "0.55rem 0.9rem", borderRadius: 9, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)", color: "#f87171", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600, fontFamily: "inherit" }}>
              Remove link
            </button>
          )}
          <button type="button" onClick={onClose} style={{ padding: "0.55rem 0.9rem", borderRadius: 9, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "rgba(240,242,255,0.65)", cursor: "pointer", fontSize: "0.8rem", fontWeight: 600, fontFamily: "inherit" }}>
            Cancel
          </button>
          <button type="button" onClick={() => onSubmit(value)} style={{ padding: "0.55rem 1rem", borderRadius: 9, border: "none", background: "linear-gradient(135deg,var(--brand),var(--brand-deep))", color: "#fff", cursor: "pointer", fontSize: "0.8rem", fontWeight: 700, fontFamily: "inherit" }}>
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
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.15rem", padding: "0.4rem", borderBottom: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)" }}>
      <ToolbarButton label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>B</ToolbarButton>
      <ToolbarButton label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></ToolbarButton>
      <span style={{ width: 1, background: "rgba(255,255,255,0.1)", margin: "4px 3px" }} />
      <ToolbarButton label="Heading" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H</ToolbarButton>
      <ToolbarButton label="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>•—</ToolbarButton>
      <ToolbarButton label="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1.</ToolbarButton>
      <span style={{ width: 1, background: "rgba(255,255,255,0.1)", margin: "4px 3px" }} />
      <ToolbarButton label="Link" active={editor.isActive("link")} onClick={() => setLinkModalOpen(true)}>Link</ToolbarButton>
      <ToolbarButton label="Insert image" onClick={() => insertImageWithUpload(editor, onUploadFile)}>Image</ToolbarButton>

      {linkModalOpen && (
        <LinkModal
          initialValue={(editor.getAttributes("link").href as string | undefined) ?? "https://"}
          hasLink={editor.isActive("link")}
          onClose={() => setLinkModalOpen(false)}
          onSubmit={(url) => {
            if (url.trim()) editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
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

/**
 * Lean rich-text editor for a Funnel Welcome page — same TipTap core as
 * app/dashboard/templates/[id]/blog/BlogRichTextEditor.tsx, deliberately without its slash
 * commands or AI-write-assistant (a short welcome message doesn't need block-level
 * authoring), reusing that file's insertImageWithUpload directly rather than duplicating
 * it. Output HTML is sanitized server-side (sanitizeBlogHtml) before ever reaching a real
 * visitor — see app/api/public/lms/[templateId]/pages/[pageId]/route.ts.
 */
export function FunnelRichTextEditor({
  initialContent, onChange, onUploadFile,
}: {
  initialContent: string;
  onChange: (html: string) => void;
  onUploadFile: (file: File) => Promise<string | null>;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      ImageExtension.configure({ HTMLAttributes: { loading: "lazy" } }),
      LinkExtension.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: "Welcome! We're glad you're here." }),
    ],
    content: initialContent || "",
    immediatelyRender: false,
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
  });

  useEffect(() => () => editor?.destroy(), [editor]);

  if (!editor) return null;

  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, overflow: "hidden", marginBottom: "0.9rem" }}>
      <Toolbar editor={editor} onUploadFile={onUploadFile} />
      <div style={{ padding: "0.9rem 1rem", minHeight: 140 }}>
        <EditorContent editor={editor} className="plexo-funnel-editor-prose" />
      </div>
      <style>{`
        .plexo-funnel-editor-prose .ProseMirror { outline: none; color: #f0f2ff; font-size: 0.9rem; line-height: 1.6; }
        .plexo-funnel-editor-prose .ProseMirror p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: rgba(240,242,255,0.3); float: left; pointer-events: none; height: 0; }
        .plexo-funnel-editor-prose .ProseMirror p { margin: 0 0 0.8em; }
        .plexo-funnel-editor-prose .ProseMirror h2 { color: #f0f2ff; font-weight: 800; font-size: 1.2em; margin: 0.6em 0 0.4em; }
        .plexo-funnel-editor-prose .ProseMirror > *:first-child { margin-top: 0; }
        .plexo-funnel-editor-prose .ProseMirror img { max-width: 100%; border-radius: 8px; }
        .plexo-funnel-editor-prose .ProseMirror ul, .plexo-funnel-editor-prose .ProseMirror ol { padding-left: 1.4em; margin: 0.6em 0; }
        .plexo-funnel-editor-prose .ProseMirror a { color: #a78bfa; }
      `}</style>
    </div>
  );
}
