import { after, NextRequest, NextResponse } from "next/server";

import { parseInboundMessages, verifyWebhookSignature } from "@/lib/whatsapp/cloudApi";
import { getWhatsAppConfig } from "@/lib/whatsapp/config";
import { dispatchInbound } from "@/lib/whatsapp/dispatch";

// Meta's WhatsApp webhook. GET is the one-time "verify this URL" handshake; POST delivers messages.
// POST only checks the signature and hands each message to the SOL Lambda, then answers 200 straight
// away — SOL can take minutes, Meta gives up after a few seconds and would redeliver.

export const maxDuration = 30;

export async function GET(request: NextRequest): Promise<Response> {
  const config = getWhatsAppConfig();
  const params = request.nextUrl.searchParams;
  if (config && params.get("hub.mode") === "subscribe" && params.get("hub.verify_token") === config.verifyToken) {
    return new Response(params.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const config = getWhatsAppConfig();
  if (!config) return NextResponse.json({ error: "WhatsApp isn't configured." }, { status: 503 });

  const raw = await request.text();
  if (!verifyWebhookSignature(raw, request.headers.get("x-hub-signature-256"), config.appSecret)) {
    return NextResponse.json({ error: "Bad signature." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad body." }, { status: 400 });
  }

  const messages = parseInboundMessages(payload);
  try {
    await Promise.all(messages.map((m) => dispatchInbound(m, (work) => after(() => work))));
  } catch (err) {
    // 500 makes Meta redeliver; the per-message dedupe makes that safe.
    console.error("[whatsapp] couldn't hand a message to SOL:", err);
    return NextResponse.json({ error: "Try again." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
