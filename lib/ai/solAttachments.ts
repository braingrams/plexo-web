import JSZip from "jszip";
import { readObject } from "@/lib/storage";

// SOL chat attachments are uploaded to the PRIVATE half of the user-content bucket (see
// app/api/v1/sol/upload/route.ts), and the transcript stores them as Anthropic-shaped
// `{type:"image"|"document", source:{type:"url", url}}` blocks. Neither model provider can
// use those as-is: a private S3 URL isn't fetchable by anyone but us, and Bedrock doesn't
// accept URL sources at all. So right before each model call, every URL-sourced block is
// swapped for what the model can actually read — inline base64 for images and PDFs,
// extracted plain text for .docx/.txt/.csv/.md — while the stored transcript keeps the
// small URL form (a base64 image would blow DynamoDB's 400 KB item limit).
//
// Anything that can't be passed along (too large, unreadable, an unsupported format)
// becomes a short text note instead, so SOL can tell the user what happened rather than
// the whole turn failing with a provider 400.

// Bedrock's per-file ceilings for Claude (the stricter of the two providers).
const MAX_IMAGE_BYTES = 3_750_000;
const MAX_PDF_BYTES = 4_500_000;
// Plenty for a real document; keeps one pasted spreadsheet from eating the context window.
const MAX_TEXT_CHARS = 150_000;
const MODEL_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

type Block = { type?: string; source?: { type?: string; url?: string; [key: string]: unknown }; filename?: string; [key: string]: unknown };
type HistoryEntry = { role: "user" | "assistant"; content: any };

function isUrlMediaBlock(block: Block): boolean {
  return (block?.type === "image" || block?.type === "document") && block.source?.type === "url" && typeof block.source.url === "string";
}

function nameOf(block: Block): string {
  if (block.filename) return block.filename;
  const last = decodeURIComponent(new URL(block.source!.url!).pathname.split("/").pop() || "");
  // Upload keys are "<uuid>-<original filename>".
  return last.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, "") || "attachment";
}

function note(text: string): Block {
  return { type: "text", text };
}

function asTextAttachment(name: string, text: string): Block {
  const trimmed = text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}\n…[truncated — the file is longer than SOL can read at once]` : text;
  return { type: "text", text: `<attached_file name="${name.replace(/"/g, "'")}">\n${trimmed}\n</attached_file>` };
}

/** word/document.xml → plain text, one line per paragraph. Good enough for the model to read
 * a brief, a price list or copy for a page; formatting isn't needed. */
async function docxToText(bytes: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) return "";
  return xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function resolveBlock(block: Block, userId: string): Promise<Block[]> {
  const url = block.source!.url!;
  const name = nameOf(block);
  // Only this user's own SOL uploads — a crafted message can't make us read anyone else's
  // private files (digital-product downloads, other users' attachments) into the model.
  let key: string;
  try {
    key = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    return [note(`[The attachment "${name}" couldn't be opened.]`)];
  }
  if (!key.startsWith(`private/sol-attachments/${userId}/`)) {
    return [note(`[The attachment "${name}" isn't one of your uploads, so SOL can't open it.]`)];
  }

  let file: { body: Buffer; contentType: string | undefined };
  try {
    file = await readObject(url);
  } catch (err) {
    console.warn("SOL attachment read failed:", url, err);
    return [note(`[The attachment "${name}" couldn't be read — it may not have finished uploading. Ask the user to attach it again.]`)];
  }
  const type = (file.contentType || "").split(";")[0].trim().toLowerCase();

  if (type.startsWith("image/")) {
    if (!MODEL_IMAGE_TYPES.has(type)) {
      return [note(`[The image "${name}" is a ${type.slice(6).toUpperCase()} file, which SOL can't view. Ask the user to send it as a JPG, PNG, GIF or WebP.]`)];
    }
    if (file.body.length > MAX_IMAGE_BYTES) {
      return [note(`[The image "${name}" is too large for SOL to view (over 3.75 MB). Ask the user to send a smaller version.]`)];
    }
    return [{ type: "image", source: { type: "base64", media_type: type, data: file.body.toString("base64") } }];
  }
  if (type === "application/pdf") {
    if (file.body.length > MAX_PDF_BYTES) {
      return [note(`[The PDF "${name}" is too large for SOL to read (over 4.5 MB). Ask the user to send a shorter document or paste the relevant part.]`)];
    }
    return [
      note(`[Attached PDF: ${name}]`),
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: file.body.toString("base64") } },
    ];
  }
  if (type === DOCX_TYPE) {
    try {
      const text = await docxToText(file.body);
      return [text ? asTextAttachment(name, text) : note(`[The document "${name}" appears to be empty.]`)];
    } catch {
      return [note(`[The document "${name}" couldn't be read as a Word file.]`)];
    }
  }
  if (type.startsWith("text/")) {
    return [asTextAttachment(name, file.body.toString("utf8"))];
  }
  return [note(`[The attachment "${name}" (${type || "unknown type"}) isn't a format SOL can read.]`)];
}

/**
 * Returns a per-turn resolver that maps a conversation history to the model-ready form.
 * Results are cached by URL for the turn, so a multi-iteration tool loop downloads each
 * attachment once rather than once per model call.
 */
export function createAttachmentResolver(userId: string): (history: HistoryEntry[]) => Promise<HistoryEntry[]> {
  const cache = new Map<string, Promise<Block[]>>();
  return async (history) => {
    if (!history.some((m) => Array.isArray(m.content) && m.content.some(isUrlMediaBlock))) return history;
    return Promise.all(
      history.map(async (message) => {
        if (!Array.isArray(message.content) || !message.content.some(isUrlMediaBlock)) return message;
        const parts = await Promise.all(
          (message.content as Block[]).map((block) => {
            if (!isUrlMediaBlock(block)) return Promise.resolve([stripFilename(block)]);
            const url = block.source!.url!;
            if (!cache.has(url)) cache.set(url, resolveBlock(block, userId));
            return cache.get(url)!;
          }),
        );
        return { ...message, content: parts.flat() };
      }),
    );
  };
}

/** `filename` is our own UI metadata on stored blocks — not a field either API accepts. */
function stripFilename(block: Block): Block {
  if (!block || typeof block !== "object" || !("filename" in block)) return block;
  const { filename: _filename, ...rest } = block;
  return rest;
}
