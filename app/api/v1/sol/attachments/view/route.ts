import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { getSignedDownloadUrl, isOwnedStorageUrl } from "@/lib/storage";

/**
 * GET /api/v1/sol/attachments/view?url=<stored attachment url>
 *
 * SOL attachments live in the private half of the bucket (see ../../upload/route.ts), so
 * the chat's image thumbnails and "open file" links can't point at the stored URL directly
 * — it 403s. This checks the file is one of the signed-in user's own SOL uploads and
 * redirects to a short-lived signed URL for it.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = request.nextUrl.searchParams.get("url") || "";
  let key = "";
  try {
    key = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    // fall through to the not-found below
  }
  if (!isOwnedStorageUrl(url) || !key.startsWith(`private/sol-attachments/${resolved.userId}/`)) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  const signed = await getSignedDownloadUrl(url, 10 * 60);
  const res = NextResponse.redirect(signed, 302);
  res.headers.set("Cache-Control", "private, max-age=300");
  return res;
}
