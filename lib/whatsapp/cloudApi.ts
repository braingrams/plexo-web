import { createHmac, timingSafeEqual } from "node:crypto";

import { getWhatsAppConfig } from "./config";

/** Meta signs every webhook body: `X-Hub-Signature-256: sha256=<hmac of the raw body with the app secret>`. */
export function verifyWebhookSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  let given: Buffer;
  try {
    given = Buffer.from(header.slice("sha256=".length), "hex");
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface InboundMedia {
  kind: "image" | "document" | "audio";
  /** Meta's media id — exchanged for the file with downloadWhatsAppMedia. */
  id: string;
  mimeType: string;
  filename: string | null;
}

export interface InboundWhatsAppMessage {
  /** Meta's message id (wamid…): also the dedupe key. */
  id: string;
  /** Sender's number, digits only. */
  from: string;
  type: string;
  /** What was typed, or the caption on a photo/document. */
  text: string | null;
  /** A photo, document or voice note attached to the message. */
  media: InboundMedia | null;
  profileName: string | null;
}

/** Pulls the customer messages out of a webhook payload. Delivery/read receipts (`statuses`)
 * and anything that isn't a message are ignored. */
export function parseInboundMessages(payload: unknown): InboundWhatsAppMessage[] {
  const out: InboundWhatsAppMessage[] = [];
  const entries = (payload as { entry?: unknown[] } | null)?.entry;
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = (change as { value?: { messages?: unknown[]; contacts?: Array<{ wa_id?: string; profile?: { name?: string } }> } })?.value;
      if (!value || !Array.isArray(value.messages)) continue;
      for (const raw of value.messages) {
        const m = raw as {
          id?: string;
          from?: string;
          type?: string;
          text?: { body?: string };
          image?: { id?: string; mime_type?: string; caption?: string };
          document?: { id?: string; mime_type?: string; filename?: string; caption?: string };
          audio?: { id?: string; mime_type?: string };
          interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
          button?: { text?: string };
        };
        if (!m.id || !m.from) continue;
        const contact = value.contacts?.find((c) => c.wa_id === m.from);
        let media: InboundMedia | null = null;
        if (m.type === "image" && m.image?.id) media = { kind: "image", id: m.image.id, mimeType: m.image.mime_type ?? "image/jpeg", filename: null };
        else if (m.type === "document" && m.document?.id) media = { kind: "document", id: m.document.id, mimeType: m.document.mime_type ?? "application/octet-stream", filename: m.document.filename ?? null };
        else if (m.type === "audio" && m.audio?.id) media = { kind: "audio", id: m.audio.id, mimeType: m.audio.mime_type ?? "audio/ogg", filename: null };
        // Quick-reply and button taps arrive as their own message types; their label is what the person "said".
        const text = m.text?.body ?? m.image?.caption ?? m.document?.caption ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? m.button?.text ?? null;
        out.push({ id: m.id, from: m.from.replace(/\D/g, ""), type: m.type ?? "unknown", text, media, profileName: contact?.profile?.name ?? null });
      }
    }
  }
  return out;
}

async function graphPost(path: string, body: unknown): Promise<Response> {
  const config = getWhatsAppConfig();
  if (!config) throw new Error("WhatsApp isn't configured on this environment.");
  return fetch(`https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** WhatsApp text bodies are capped at 4096 characters — callers split first (format.ts). */
export async function sendWhatsAppText(to: string, body: string): Promise<void> {
  const res = await graphPost("messages", { messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body, preview_url: true } });
  if (!res.ok) throw new Error(`WhatsApp send failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 300)}`);
}

/** Marks the person's message as read and shows "typing…" (it lasts up to ~25s, so long turns re-send it).
 * Purely cosmetic — a failure here must never stop the real reply. */
export async function sendTypingIndicator(messageId: string): Promise<void> {
  try {
    await graphPost("messages", { messaging_product: "whatsapp", status: "read", message_id: messageId, typing_indicator: { type: "text" } });
  } catch {
    // ignore
  }
}

/** Largest file we'll pull from WhatsApp (they allow up to 100MB for documents). */
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

/** Downloads what someone sent: Meta first swaps the media id for a short-lived URL, which then needs the same token. */
export async function downloadWhatsAppMedia(mediaId: string): Promise<{ bytes: Buffer; mimeType: string }> {
  const config = getWhatsAppConfig();
  if (!config) throw new Error("WhatsApp isn't configured on this environment.");
  const headers = { Authorization: `Bearer ${config.accessToken}` };
  const metaRes = await fetch(`https://graph.facebook.com/${config.graphVersion}/${mediaId}`, { headers });
  if (!metaRes.ok) throw new Error(`WhatsApp media lookup failed (${metaRes.status}).`);
  const meta = (await metaRes.json()) as { url?: string; mime_type?: string; file_size?: number };
  if (!meta.url) throw new Error("WhatsApp media lookup returned no URL.");
  if (typeof meta.file_size === "number" && meta.file_size > MAX_MEDIA_BYTES) throw new MediaTooLargeError();
  const fileRes = await fetch(meta.url, { headers });
  if (!fileRes.ok) throw new Error(`WhatsApp media download failed (${fileRes.status}).`);
  const bytes = Buffer.from(await fileRes.arrayBuffer());
  if (bytes.length > MAX_MEDIA_BYTES) throw new MediaTooLargeError();
  return { bytes, mimeType: meta.mime_type ?? "application/octet-stream" };
}

export class MediaTooLargeError extends Error {
  constructor() {
    super("That file is too large.");
    this.name = "MediaTooLargeError";
  }
}
