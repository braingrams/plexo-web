"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import ImageExtension from "@tiptap/extension-image";
import LinkExtension from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import { useEffect } from "react";
import { SlashCommand } from "./slashCommand/SlashCommand";

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

function Toolbar({ editor, onInsertImage }: { editor: Editor; onInsertImage: () => void }) {
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
      <ToolbarButton label="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>&bull; List</ToolbarButton>
      <ToolbarButton label="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1. List</ToolbarButton>
      <ToolbarButton label="Quote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>&ldquo; &rdquo;</ToolbarButton>
      <ToolbarButton label="Code block" active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>{"{ }"}</ToolbarButton>
      <span style={{ width: 1, background: "rgba(255,255,255,0.1)", margin: "4px 4px" }} />
      <ToolbarButton label="Align left" active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()}>&#8676;</ToolbarButton>
      <ToolbarButton label="Align center" active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}>&#8677;</ToolbarButton>
      <ToolbarButton label="Align right" active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()}>&#8678;</ToolbarButton>
      <span style={{ width: 1, background: "rgba(255,255,255,0.1)", margin: "4px 4px" }} />
      <ToolbarButton
        label="Link"
        active={editor.isActive("link")}
        onClick={() => {
          const previousUrl = editor.getAttributes("link").href as string | undefined;
          const url = window.prompt("Link URL", previousUrl ?? "https://");
          if (url === null) return;
          if (!url) {
            editor.chain().focus().extendMarkRange("link").unsetLink().run();
          } else {
            editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
          }
        }}
      >
        Link
      </ToolbarButton>
      <ToolbarButton label="Insert image" onClick={onInsertImage}>Image</ToolbarButton>
      <span style={{ flex: 1 }} />
      <ToolbarButton label="Undo" onClick={() => editor.chain().focus().undo().run()}>&#8630;</ToolbarButton>
      <ToolbarButton label="Redo" onClick={() => editor.chain().focus().redo().run()}>&#8631;</ToolbarButton>
    </div>
  );
}

export function BlogRichTextEditor({
  initialContent,
  onChange,
  onUploadImage,
}: {
  initialContent: unknown;
  onChange: (json: unknown, html: string) => void;
  onUploadImage: () => Promise<string | null>;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      ImageExtension.configure({ HTMLAttributes: { loading: "lazy" } }),
      LinkExtension.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: "Start writing your post… (type / for blocks)" }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      SlashCommand.configure({ onUploadImage }),
    ],
    content: (initialContent as object) ?? "",
    immediatelyRender: false,
    onUpdate: ({ editor: e }) => onChange(e.getJSON(), e.getHTML()),
  });

  useEffect(() => () => editor?.destroy(), [editor]);

  if (!editor) return null;

  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, overflow: "hidden" }}>
      <Toolbar
        editor={editor}
        onInsertImage={async () => {
          const url = await onUploadImage();
          if (url) editor.chain().focus().setImage({ src: url }).run();
        }}
      />
      <div style={{ padding: "1.25rem", minHeight: 360 }}>
        <EditorContent editor={editor} className="plexo-editor-prose" />
      </div>
      <style>{`
        .plexo-editor-prose .ProseMirror { outline: none; color: #f0f2ff; font-size: 1rem; line-height: 1.7; }
        .plexo-editor-prose .ProseMirror p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: rgba(240,242,255,0.3); float: left; pointer-events: none; height: 0; }
        .plexo-editor-prose .ProseMirror img { max-width: 100%; border-radius: 8px; }
        .plexo-editor-prose .ProseMirror blockquote { border-left: 3px solid var(--brand); margin: 1em 0; padding-left: 1em; color: rgba(240,242,255,0.7); }
        .plexo-editor-prose .ProseMirror pre { background: #0b0f19; padding: 12px; border-radius: 8px; overflow-x: auto; }
        .plexo-editor-prose .ProseMirror code { background: rgba(255,255,255,0.08); padding: 2px 5px; border-radius: 4px; }
        .plexo-editor-prose .ProseMirror pre code { background: none; padding: 0; }
      `}</style>
    </div>
  );
}
