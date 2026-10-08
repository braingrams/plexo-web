import { NextRequest, NextResponse } from "next/server";

import { sharedAttachmentLink } from "@/lib/sol/share";

/**
 * GET /api/v1/sol/shared/:token/attachment?url=<stored attachment url> — an image in a
 * shared SOL conversation, for someone viewing the share (no sign-in). Only an image that's
 * actually part of that share opens; it's served through a short-lived signed link, since
 * chat attachments stay private.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  const { token } = await context.params;
  const url = request.nextUrl.searchParams.get("url") || "";
  const signed = url ? await sharedAttachmentLink(token, url) : null;
  if (!signed) return NextResponse.json({ error: "Image not found." }, { status: 404 });
  const res = NextResponse.redirect(signed, 302);
  res.headers.set("Cache-Control", "private, max-age=300");
  return res;
}
