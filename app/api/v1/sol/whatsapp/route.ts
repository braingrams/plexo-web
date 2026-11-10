import { randomInt } from "node:crypto";
import QRCode from "qrcode";
import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { WhatsAppLinkCode, WhatsAppUserLink } from "@/lib/db/whatsappEntities";
import { getWhatsAppConfig } from "@/lib/whatsapp/config";
import { unlinkPhone } from "@/lib/whatsapp/inbound";

// The dashboard's "Chat with SOL on WhatsApp" card.
//   GET    → is it available, and is this account connected?
//   POST   → a one-time code, a ready-to-send wa.me link (tap Send) and a QR code of it (scan from a computer)
//   DELETE → disconnect the number

const CODE_MINUTES = 15;

const NOT_AVAILABLE = "WhatsApp isn't available yet. We're finishing the setup — check back soon.";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: link } = await WhatsAppUserLink.get({ userId: resolved.userId }).go();
  return NextResponse.json({ available: getWhatsAppConfig() !== null, phone: link?.phone ?? null });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const config = getWhatsAppConfig();
  if (!config) return NextResponse.json({ error: NOT_AVAILABLE }, { status: 503 });

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(Date.now() + CODE_MINUTES * 60_000).toISOString();
  await WhatsAppLinkCode.create({ code, userId: resolved.userId, organizationId: resolved.organizationId, expiresAt }).go();

  // Opens WhatsApp (app or web) with the message already typed.
  const link = `https://wa.me/${config.businessNumber}?text=${encodeURIComponent(`LINK ${code}`)}`;
  // For someone on a computer: scan with the phone's camera and WhatsApp opens with the same message ready.
  const svg = await QRCode.toString(link, { type: "svg", margin: 1, width: 220, errorCorrectionLevel: "M" });

  return NextResponse.json({
    code,
    expiresAt,
    link,
    qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    number: config.businessNumber,
  });
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: link } = await WhatsAppUserLink.get({ userId: resolved.userId }).go();
  if (link) await unlinkPhone(link.phone);
  return NextResponse.json({ ok: true });
}
