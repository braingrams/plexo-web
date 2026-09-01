import { NextRequest, NextResponse } from "next/server";
import { issueSignedToken, presignUrl } from "@vercel/blob";

import { prisma } from "@/server/prisma";
import { decryptDigitalAccessSecret } from "@/lib/crypto";
import { checkCommerceRateLimit, clientIp } from "@/lib/commerceRateLimit";

// Blob pathname is everything after the store host in fileUrl, e.g.
// "https://<store>.public.blob.vercel-storage.com/commerce-digital/org/product/abc.pdf"
// -> "commerce-digital/org/product/abc.pdf". presignUrl needs the bare pathname, not the
// full URL.
function pathnameFromBlobUrl(blobUrl: string): string {
  return new URL(blobUrl).pathname.replace(/^\//, "");
}

/**
 * The only credential this route trusts is the token itself — a random 32-byte value,
 * unguessable, scoped to exactly one (order, product) pair by
 * CommerceDigitalDelivery.@@unique([orderId, productId]). No site/hostname resolution is
 * needed for authorization; it's still rate-limited by IP alone as basic abuse protection
 * (this endpoint has no natural per-site bucket the way checkout/order-lookup do, since a
 * token isn't tied to any one request's hostname).
 */
export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  const { token } = await context.params;

  const allowed = await checkCommerceRateLimit(`commerce:digital-delivery:${clientIp(request)}`, 30);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests. Please try again shortly." }, { status: 429 });
  }

  const delivery = await prisma.commerceDigitalDelivery.findUnique({ where: { token } });
  if (!delivery) {
    return NextResponse.json({ error: "This link is invalid." }, { status: 404 });
  }
  if (delivery.expiresAt && delivery.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: "This link has expired. Contact the seller for a new one." }, { status: 410 });
  }

  if (delivery.method === "FILE_DOWNLOAD") {
    if (!delivery.fileUrl) {
      return NextResponse.json({ error: "This product has no file attached." }, { status: 404 });
    }
    if (delivery.maxDownloads !== null && delivery.downloadCount >= delivery.maxDownloads) {
      return NextResponse.json({ error: "This link has reached its download limit. Contact the seller for a new one." }, { status: 410 });
    }

    await prisma.commerceDigitalDelivery.update({ where: { id: delivery.id }, data: { downloadCount: { increment: 1 } } });

    // Never expose the permanent private blob URL directly — mint a short-lived (5 min)
    // signed read URL scoped to exactly this one pathname and redirect to that instead.
    const pathname = pathnameFromBlobUrl(delivery.fileUrl);
    const signed = await issueSignedToken({ pathname, operations: ["get"], validUntil: Date.now() + 5 * 60 * 1000 });
    const { presignedUrl } = await presignUrl(signed, { operation: "get", pathname, access: "private" });
    return NextResponse.redirect(presignedUrl, { status: 302 });
  }

  if (delivery.method === "EXTERNAL_LINK") {
    if (!delivery.externalUrl) {
      return NextResponse.json({ error: "This product has no link attached." }, { status: 404 });
    }
    return NextResponse.redirect(delivery.externalUrl, { status: 302 });
  }

  // ACCESS_LIST — a small branded "see it again" page, same content as the delivery email.
  const password = delivery.accessPasswordEncrypted ? decryptDigitalAccessSecret(delivery.accessPasswordEncrypted) : null;
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Your access</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { margin:0; padding:40px 20px; background:#f8fafc; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; color:#0f172a; }
  .card { max-width:480px; margin:0 auto; background:#fff; border:1px solid #e2e8f0; border-radius:16px; padding:32px; }
  h1 { font-size:22px; margin:0 0 16px; }
  .instructions { white-space:pre-wrap; background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:18px 20px; font-size:14px; line-height:1.6; color:#334155; }
  .password { margin-top:20px; font-size:14px; }
  .password strong { font-family:monospace; background:#f1f5f9; padding:2px 8px; border-radius:6px; }
</style></head>
<body>
  <div class="card">
    <h1>Your access</h1>
    <div class="instructions">${delivery.accessInstructions ?? ""}</div>
    ${password ? `<p class="password">Password: <strong>${password}</strong></p>` : ""}
  </div>
</body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
