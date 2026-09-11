import { PageSizes, PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from "pdf-lib";

import type { DocBlock, DocumentModel } from "./exportDocument";

// pdf-lib is a low-level PDF library — no automatic flowing text layout like a
// Chromium-based renderer (Puppeteer/Playwright) would give us, chosen deliberately to
// stay Lambda-friendly (no headless-browser binary to ship/cold-start). Word-wrapping and
// page breaks below are therefore implemented by hand: a simple greedy word-wrap measured
// with the font's widthOfTextAtSize, and a new PDFPage started whenever the running Y
// position runs out of room. This is a real, accepted trade-off: the PDF export reads
// correctly but is visually much plainer than the HTML/DOCX exports of the same
// conversation (no embedded images — see the imageRef case below — no rich typography,
// and a single code block is not itself paginated if it's taller than one full page).

const PAGE_SIZE = PageSizes.Letter;
const MARGIN = 54;
const CONTENT_WIDTH = PAGE_SIZE[0] - MARGIN * 2;
const LINE_GAP = 4;

const COLOR = {
  text: rgb(0.1, 0.1, 0.16),
  muted: rgb(0.42, 0.45, 0.5),
  success: rgb(0.086, 0.639, 0.29),
  error: rgb(0.86, 0.15, 0.15),
  cancelled: rgb(0.85, 0.47, 0.02),
  codeBackground: rgb(0.06, 0.07, 0.09),
  codeText: rgb(0.9, 0.91, 0.94),
};

interface DrawState {
  pdfDoc: PDFDocument;
  page: PDFPage;
  y: number;
  fonts: { regular: PDFFont; bold: PDFFont; mono: PDFFont };
}

/** Greedy word-wrap: fits as many words per line as stay within maxWidth at the given
 * font/size, measured with PDFFont.widthOfTextAtSize. */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Starts a fresh page (reset to the top margin) if the next `neededHeight` of content
 * wouldn't fit above the bottom margin on the current page. */
function ensureRoom(state: DrawState, neededHeight: number): void {
  if (state.y - neededHeight < MARGIN) {
    state.page = state.pdfDoc.addPage(PAGE_SIZE);
    state.y = PAGE_SIZE[1] - MARGIN;
  }
}

function drawLines(state: DrawState, lines: string[], opts: { font: PDFFont; size: number; color: ReturnType<typeof rgb>; lineHeight: number }): void {
  for (const line of lines) {
    ensureRoom(state, opts.lineHeight);
    state.y -= opts.lineHeight;
    state.page.drawText(line, { x: MARGIN, y: state.y, size: opts.size, font: opts.font, color: opts.color });
  }
}

function drawBlock(state: DrawState, block: DocBlock): void {
  const { fonts } = state;

  switch (block.kind) {
    case "heading": {
      const size = block.level === 1 ? 20 : block.level === 2 ? 16 : 13;
      const lineHeight = size + LINE_GAP + 4;
      ensureRoom(state, lineHeight + 8);
      state.y -= 8;
      drawLines(state, wrapText(block.text, fonts.bold, size, CONTENT_WIDTH), { font: fonts.bold, size, color: COLOR.text, lineHeight });
      state.y -= 4;
      break;
    }

    case "paragraph": {
      const size = 11;
      const lineHeight = size + LINE_GAP;
      const lines = block.text.split("\n").flatMap((line) => wrapText(line, fonts.regular, size, CONTENT_WIDTH));
      drawLines(state, lines, { font: fonts.regular, size, color: COLOR.text, lineHeight });
      state.y -= 6;
      break;
    }

    case "toolAction": {
      const size = 10.5;
      const lineHeight = size + LINE_GAP;
      const prefix = block.status === "success" ? "[done] " : block.status === "error" ? "[failed] " : "[cancelled] ";
      const lines = wrapText(`${prefix}${block.label}`, fonts.regular, size, CONTENT_WIDTH);
      drawLines(state, lines, { font: fonts.regular, size, color: COLOR[block.status], lineHeight });
      state.y -= 4;
      break;
    }

    case "codeBlock": {
      const size = 9.5;
      const lineHeight = size + LINE_GAP;
      const rawLines = block.code.split("\n");
      const lines = rawLines.flatMap((line) => (line.length ? wrapText(line, fonts.mono, size, CONTENT_WIDTH - 16) : [""]));
      const blockHeight = lines.length * lineHeight + 12;

      // A single code block is drawn as one reserved region and is not itself split
      // across a page break (see the file-level comment) — only "make room, or start a
      // fresh page" like every other block.
      ensureRoom(state, blockHeight);
      const boxTop = state.y;
      state.page.drawRectangle({ x: MARGIN - 8, y: boxTop - blockHeight, width: CONTENT_WIDTH + 16, height: blockHeight, color: COLOR.codeBackground });

      state.y -= 6;
      for (const line of lines) {
        state.y -= lineHeight;
        state.page.drawText(line, { x: MARGIN, y: state.y, size, font: fonts.mono, color: COLOR.codeText });
      }
      state.y = boxTop - blockHeight - 8;
      break;
    }

    case "imageRef": {
      // No headless browser here to render an <img> — and fetching+decoding the remote
      // image into pdf-lib's embedPng/embedJpg would add a network round trip (and a
      // whole new failure surface: auth, timeouts, unsupported formats) to a document
      // export. Rendered as a plain reference line instead, matching the DOCX renderer's
      // same trade-off (see renderDocx.ts); only the HTML export shows the image inline.
      const size = 10;
      const lineHeight = size + LINE_GAP;
      const label = block.alt ? `[Image: ${block.alt}]` : "[Image]";
      drawLines(state, wrapText(label, fonts.regular, size, CONTENT_WIDTH), { font: fonts.regular, size, color: COLOR.muted, lineHeight });
      drawLines(state, wrapText(block.url, fonts.regular, size, CONTENT_WIDTH), { font: fonts.regular, size, color: COLOR.muted, lineHeight });
      state.y -= 6;
      break;
    }
  }
}

/**
 * Renders a DocumentModel to a PDF file buffer using pdf-lib (deliberately not a
 * Chromium-based renderer — see the file-level comment above for why, and for the
 * accepted visual-fidelity trade-offs).
 */
export async function renderDocumentToPdf(doc: DocumentModel): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(doc.title);
  pdfDoc.setCreator("SOL");
  pdfDoc.setCreationDate(new Date(doc.generatedAt));

  const [regular, bold, mono] = await Promise.all([
    pdfDoc.embedFont(StandardFonts.Helvetica),
    pdfDoc.embedFont(StandardFonts.HelveticaBold),
    pdfDoc.embedFont(StandardFonts.Courier),
  ]);

  const page = pdfDoc.addPage(PAGE_SIZE);
  const state: DrawState = { pdfDoc, page, y: PAGE_SIZE[1] - MARGIN, fonts: { regular, bold, mono } };

  for (const block of doc.blocks) {
    drawBlock(state, block);
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}
