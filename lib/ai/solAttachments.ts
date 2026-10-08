import JSZip from "jszip";
import { createHash } from "node:crypto";
import { readObject, uploadObject } from "@/lib/storage";

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
    return [
      // How SOL puts this image on a page (see publishAttachedImage) — the user's own photo,
      // not a stock one.
      note(`[Attached image "${name}" — to use it on a page, call use_attached_image with attachment "${attachmentRef(url)}".]`),
      { type: "image", source: { type: "base64", media_type: type, data: file.body.toString("base64") } },
    ];
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

const PAGE_IMAGE_EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg", "image/avif": "avif" };

/**
 * A short, stable reference for an attachment, given to the model instead of its address.
 * The model used to copy the address back — and file names carry characters it doesn't
 * reproduce (macOS/WhatsApp put a narrow no-break space, U+202F, before "PM"), so the copy
 * pointed at a file that doesn't exist and S3 answered "access denied".
 */
export function attachmentRef(url: string): string {
  return `img_${createHash("sha256").update(url).digest("hex").slice(0, 12)}`;
}

/** Marks a chat attachment's private address — never something to put in a page. */
export const PRIVATE_ATTACHMENT_PATH = "/private/sol-attachments/";

type HistoryLike = Array<{ content: unknown }>;

/** The attachment address a reference (or a copied address, however mangled) points to in this conversation. */
function findAttachment(history: HistoryLike, reference: string): string | null {
  const squash = (v: string) => { try { v = decodeURIComponent(v); } catch { /* keep */ } return v.normalize("NFKC").replace(/\s+/g, " ").trim(); };
  const wanted = squash(reference);
  for (const entry of history) {
    for (const block of Array.isArray(entry.content) ? (entry.content as Block[]) : []) {
      if (!isUrlMediaBlock(block)) continue;
      const url = block.source!.url!;
      if (attachmentRef(url) === reference || squash(url) === wanted) return url;
    }
  }
  return null;
}

/**
 * A public address for one image the user attached to this chat, for use on a page. Chat
 * attachments stay private; only an image SOL is asked to put on a page is copied out — to
 * a content-addressed key, so using the same image again doesn't make another copy.
 */
export async function publishAttachedImage(userId: string, attachment: unknown, history: HistoryLike): Promise<{ url: string }> {
  if (typeof attachment !== "string" || !attachment) throw new Error("Pass the attachment reference shown next to the image (like img_1a2b3c4d5e6f).");
  const url = findAttachment(history, attachment);
  if (!url) throw new Error("That image isn't in this conversation any more — ask the user to attach it again.");
  let key: string;
  try {
    key = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    throw new Error("That image couldn't be opened — ask the user to attach it again.");
  }
  if (!key.startsWith(`private/sol-attachments/${userId}/`)) throw new Error("That image isn't one of this user's attachments.");
  let file: { body: Buffer; contentType: string | undefined };
  try {
    file = await readObject(url);
  } catch (err) {
    console.error("[sol] couldn't read an attachment for a page:", url, err);
    throw new Error("That image couldn't be read — it may not have finished uploading. Ask the user to attach it again.");
  }
  const type = (file.contentType || "").split(";")[0].trim().toLowerCase();
  const extension = PAGE_IMAGE_EXTENSIONS[type];
  if (!extension) throw new Error(`That attachment isn't an image a web page can show (${type || "unknown type"}).`);
  const hash = createHash("sha256").update(file.body).digest("hex").slice(0, 40);
  try {
    return await uploadObject(`sol-images/${userId}/${hash}.${extension}`, file.body, { access: "public", contentType: type });
  } catch (err) {
    console.error("[sol] couldn't save an attached image for a page:", err);
    throw new Error("Plexo couldn't save that image for the page just now. Tell the user it's a problem on Plexo's side and to try again in a few minutes.");
  }
}
