import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { OAuthClient } from "@/lib/db/coreEntities";
import { OAuthAuthorizationCode } from "@/lib/db/opsEntities";
import { rotateMcpApiKey } from "@/lib/mcp/issueApiKey";

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function base64UrlSha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function oauthError(error: string, description: string, status = 400): NextResponse {
  return NextResponse.json({ error, error_description: description }, { status, headers: CORS_HEADERS });
}

/**
 * POST /api/v1/auth/oauth/token
 *
 * OAuth 2.0/2.1 Token Endpoint. Previously this had no real validation at all: any
 * "code" (or even "token") string starting with "plexo_" was echoed straight back as a
 * valid access_token, and if nothing matched, it fell back to Scanning the ENTIRE ApiKey
 * table for the most-recently-created active key across every org and handing that back
 * — a live, unauthenticated cross-tenant credential-shaped response to any caller. This
 * now does a real authorization_code exchange: the code must exist, be unexpired and
 * unused, match the client_id/redirect_uri it was issued for, and (when PKCE was used at
 * /authorize) the code_verifier must hash to the stored code_challenge — only then is a
 * real access token minted, scoped to the user/org the code was issued for.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const contentType = request.headers.get("content-type") || "";
  let body: Record<string, unknown>;
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await request.formData();
    body = Object.fromEntries(form.entries());
  } else {
    body = await request.json().catch(() => ({}));
  }

  const grantType = body.grant_type;
  if (grantType !== "authorization_code") {
    return oauthError("unsupported_grant_type", "Only grant_type=authorization_code is supported.");
  }

  const code = typeof body.code === "string" ? body.code : "";
  const redirectUri = typeof body.redirect_uri === "string" ? body.redirect_uri : "";
  const clientId = typeof body.client_id === "string" ? body.client_id : "";
  const clientSecret = typeof body.client_secret === "string" ? body.client_secret : "";
  const codeVerifier = typeof body.code_verifier === "string" ? body.code_verifier : "";

  if (!code || !clientId) {
    return oauthError("invalid_request", "code and client_id are required.");
  }

  const { data: client } = await OAuthClient.get({ clientId }).go();
  if (!client) {
    return oauthError("invalid_client", "Unrecognized client_id.");
  }
  if (client.clientSecretHash) {
    if (!clientSecret || sha256Hex(clientSecret) !== client.clientSecretHash) {
      return oauthError("invalid_client", "client_secret is missing or incorrect.", 401);
    }
  }

  const { data: authCode } = await OAuthAuthorizationCode.get({ code }).go();
  if (!authCode) {
    return oauthError("invalid_grant", "This code is invalid or has expired.");
  }
  // DynamoDB's TTL sweep can lag well behind the record's actual expiry — the ttl
  // attribute itself is the source of truth for whether this code is still live, not
  // just whether the row has been physically deleted yet.
  if (authCode.used || (authCode.ttl ?? 0) * 1000 < Date.now()) {
    return oauthError("invalid_grant", "This code has already been used or has expired.");
  }
  if (authCode.clientId !== clientId) {
    return oauthError("invalid_grant", "This code was not issued to this client.");
  }
  if (redirectUri && authCode.redirectUri !== redirectUri) {
    return oauthError("invalid_grant", "redirect_uri does not match the one used to obtain this code.");
  }

  if (authCode.codeChallenge) {
    if (!codeVerifier) {
      return oauthError("invalid_grant", "code_verifier is required for this code.");
    }
    const matches = authCode.codeChallengeMethod === "plain"
      ? codeVerifier === authCode.codeChallenge
      : base64UrlSha256(codeVerifier) === authCode.codeChallenge;
    if (!matches) {
      return oauthError("invalid_grant", "code_verifier does not match the original code_challenge.");
    }
  }

  // Burn the code immediately — single-use, whether or not the key mint below succeeds,
  // so a retry after a transient failure can't replay the same code.
  await OAuthAuthorizationCode.patch({ code }).set({ used: true }).go();

  const accessToken = await rotateMcpApiKey(authCode.userId, authCode.organizationId);

  return NextResponse.json(
    { access_token: accessToken, token_type: "Bearer", expires_in: 31536000 },
    { headers: CORS_HEADERS },
  );
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
}
