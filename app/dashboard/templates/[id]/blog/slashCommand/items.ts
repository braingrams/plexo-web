import type { Editor, Range } from "@tiptap/core";

export interface SlashCommandItem {
  title: string;
  description: string;
  keywords: string[];
  run: (editor: Editor, range: Range) => void;
}

/** Executed after uploading an image via the same picker the toolbar's Image button uses. */
export function buildSlashCommandItems(onUploadImage: () => Promise<string | null>): SlashCommandItem[] {
  return [
    {
      title: "Heading 1",
      description: "Big section heading",
      keywords: ["h1", "heading", "title"],
      run: (editor, range) => editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run(),
    },
    {
      title: "Heading 2",
      description: "Medium section heading",
      keywords: ["h2", "heading", "subheading"],
      run: (editor, range) => editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run(),
    },
    {
      title: "Heading 3",
      description: "Small section heading",
      keywords: ["h3", "heading"],
      run: (editor, range) => editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run(),
    },
    {
      title: "Bulleted list",
      description: "Simple bulleted list",
      keywords: ["bullet", "list", "ul"],
      run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
    },
    {
      title: "Numbered list",
      description: "List with numbering",
      keywords: ["numbered", "ordered", "list", "ol"],
      run: (editor, range) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
    },
    {
      title: "Quote",
      description: "Capture a quote",
      keywords: ["quote", "blockquote", "citation"],
      run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
    },
    {
      title: "Code block",
      description: "Formatted code snippet",
      keywords: ["code", "codeblock", "snippet"],
      run: (editor, range) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
    },
    {
      title: "Divider",
      description: "Horizontal rule",
      keywords: ["divider", "hr", "rule", "separator"],
      run: (editor, range) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
    },
    {
      title: "Image",
      description: "Upload and embed an image",
      keywords: ["image", "photo", "picture", "upload"],
      run: (editor, range) => {
        editor.chain().focus().deleteRange(range).run();
        onUploadImage().then((url) => {
          if (url) editor.chain().focus().setImage({ src: url }).run();
        });
      },
    },
  ];
}
