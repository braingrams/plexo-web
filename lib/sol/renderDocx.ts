import { Document, ExternalHyperlink, HeadingLevel, Packer, Paragraph, ShadingType, TextRun } from "docx";
import type { IRunOptions } from "docx";

import type { DocBlock, DocumentModel } from "./exportDocument";

const HEADING_LEVEL_BY_DEPTH = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
} as const;

const STATUS_PREFIX: Record<"success" | "error" | "cancelled", string> = {
  success: "✓ ",
  error: "✗ ",
  cancelled: "⦸ ",
};

const STATUS_COLOR: Record<"success" | "error" | "cancelled", string> = {
  success: "16A34A",
  error: "DC2626",
  cancelled: "D97706",
};

/** Splits text on "\n" into a single Paragraph's TextRun children, using docx's
 * `break: 1` (a line break rendered before that run) to keep multi-line text (a user's
 * multi-paragraph message, a multi-line tool result) inside one Word paragraph instead of
 * collapsing onto a single line. */
function textRunsForMultiline(text: string, extra: Omit<IRunOptions, "text" | "break"> = {}): TextRun[] {
  return text.split("\n").map((line, index) => new TextRun({ ...extra, text: line, break: index === 0 ? undefined : 1 }));
}

function renderBlock(block: DocBlock): Paragraph {
  switch (block.kind) {
    case "heading":
      return new Paragraph({
        heading: HEADING_LEVEL_BY_DEPTH[block.level],
        children: textRunsForMultiline(block.text),
        spacing: { before: 240, after: 120 },
      });

    case "paragraph":
      return new Paragraph({
        children: textRunsForMultiline(block.text),
        spacing: { after: 160 },
      });

    case "toolAction":
      return new Paragraph({
        children: [
          new TextRun({
            text: `${STATUS_PREFIX[block.status]}${block.label}`,
            color: STATUS_COLOR[block.status],
            bold: block.status !== "success",
          }),
        ],
        shading: { type: ShadingType.CLEAR, fill: "F3F4F6" },
        spacing: { before: 80, after: 80 },
      });

    case "codeBlock":
      return new Paragraph({
        children: textRunsForMultiline(block.code || " ", { font: "Courier New", size: 18, color: "E5E7EB" }),
        shading: { type: ShadingType.CLEAR, fill: "0F1117" },
        spacing: { after: 160 },
      });

    case "imageRef": {
      // docx's ImageRun needs real image bytes, not a URL — embedding would mean
      // fetching the remote file over the network at export time (auth, timeouts,
      // unsupported formats all become new failure modes for what's meant to be a quick
      // document export). Rendered as a plain link instead, same trade-off as the PDF
      // renderer (see renderPdf.ts) makes explicit; only the HTML export embeds the
      // image directly, since a browser fetches it itself with no extra work here.
      const label = block.alt ? `Image: ${block.alt} — ` : "Image — ";
      return new Paragraph({
        children: [
          new TextRun({ text: label, italics: true }),
          new ExternalHyperlink({ link: block.url, children: [new TextRun({ text: block.url, style: "Hyperlink" })] }),
        ],
        spacing: { after: 160 },
      });
    }
  }
}

/**
 * Renders a DocumentModel to a .docx file buffer using the `docx` package's
 * Document/Paragraph/TextRun/Packer API.
 */
export async function renderDocumentToDocx(doc: DocumentModel): Promise<Buffer> {
  const file = new Document({
    creator: "SOL",
    title: doc.title,
    description: `SOL conversation exported ${doc.generatedAt}`,
    sections: [{ children: doc.blocks.map(renderBlock) }],
  });

  return Packer.toBuffer(file);
}
