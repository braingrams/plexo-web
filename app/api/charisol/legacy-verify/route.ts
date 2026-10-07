import { NextRequest, NextResponse } from "next/server";

import { handleLegacyVerify } from "@/server/charisolLegacyVerify";

/**
 * POST /api/charisol/legacy-verify
 *
 * Server-to-server callback from Charisol Auth (register this URL in the Charisol developer
 * portal; staff approve it before it is ever called). No session/cookie/CSRF applies — the
 * caller is authenticated by an Ed25519 signature over the RAW body, checked in
 * server/charisolLegacyVerify.ts. middleware.ts's /api/ branch only adds CORS headers and
 * never requires a session, so nothing else gates this route. Never log the body: it carries
 * a plaintext password.
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  // The signature covers the exact bytes Charisol sent, so read the raw text and only then
  // parse — never request.json() first.
  const rawBody = await request.text();
  const { status, body } = await handleLegacyVerify(request, rawBody);
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
