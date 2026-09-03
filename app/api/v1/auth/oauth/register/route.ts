import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { OAuthClient } from "@/lib/db/coreEntities";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/**
 * POST /api/v1/auth/oauth/register
 *
 * Dynamic Client Registration (RFC 7591) for MCP/OAuth clients (Claude, ChatGPT, Cursor,
 * etc). Previously this returned the SAME hardcoded client_id/client_secret to every
 * caller and silently dropped redirect_uris entirely — meaning nothing was actually
 * registered, and /authorize had no real record to validate a redirect_uri against (a
 * genuine open-redirect: it trusted whatever redirect_uri a caller supplied). Every
 * client now gets its own client_id, its registered redirect_uris are persisted, and
 * /authorize only allows an exact match against them.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => ({}));
  const clientName = typeof body.client_name === "string" && body.client_name.trim() ? body.client_name.trim() : "MCP Client";
  const redirectUris: unknown = body.redirect_uris;
  const tokenEndpointAuthMethod = body.token_endpoint_auth_method === "client_secret_post" || body.token_endpoint_auth_method === "client_secret_basic"
    ? body.token_endpoint_auth_method
    : "none";

  if (!Array.isArray(redirectUris) || redirectUris.length === 0 || !redirectUris.every((u) => typeof u === "string" && u.length > 0)) {
    return NextResponse.json(
      { error: "invalid_client_metadata", error_description: "redirect_uris is required and must be a non-empty array of strings." },
      { status: 400, headers: CORS_HEADERS },
    );
  }
  for (const uri of redirectUris) {
    try {
      const parsed = new URL(uri);
      if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1"))) {
        return NextResponse.json(
          { error: "invalid_redirect_uri", error_description: `redirect_uri "${uri}" must be HTTPS (or http://localhost for local development).` },
          { status: 400, headers: CORS_HEADERS },
        );
      }
    } catch {
      return NextResponse.json(
        { error: "invalid_redirect_uri", error_description: `"${uri}" is not a valid URL.` },
        { status: 400, headers: CORS_HEADERS },
      );
    }
  }

  const clientId = `plexo_client_${randomBytes(16).toString("hex")}`;
  let clientSecret: string | undefined;
  let clientSecretHash: string | undefined;
  if (tokenEndpointAuthMethod !== "none") {
    clientSecret = randomBytes(32).toString("hex");
    clientSecretHash = sha256(clientSecret);
  }

  await OAuthClient.create({
    clientId,
    clientSecretHash,
    clientName,
    redirectUris,
    tokenEndpointAuthMethod,
  }).go();

  return NextResponse.json(
    {
      client_id: clientId,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
      client_name: clientName,
      redirect_uris: redirectUris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: tokenEndpointAuthMethod,
    },
    { headers: CORS_HEADERS },
  );
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
}
