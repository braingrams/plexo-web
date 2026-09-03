import { NextRequest, NextResponse } from "next/server";
import { OAuthClient } from "@/lib/db/coreEntities";

/**
 * GET /api/v1/auth/oauth/authorize
 *
 * OAuth 2.0/2.1 Authorization Endpoint for Claude Web & Remote MCP Connectors.
 *
 * Previously this redirected to /mcp/login with whatever redirect_uri the caller
 * supplied, no questions asked — an open redirect: a crafted link to this endpoint could
 * redirect a logged-in user's real Plexo API key to an attacker-controlled domain. Now
 * client_id must resolve to a real OAuthClient (from a prior /register call) and
 * redirect_uri must EXACTLY match one of that client's registered redirect_uris before
 * anything gets redirected anywhere — on failure this renders an error directly instead
 * of redirecting, since redirecting on a validation failure is itself the vulnerability.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("client_id");
  const redirectUri = searchParams.get("redirect_uri");
  const state = searchParams.get("state") || "";
  const codeChallenge = searchParams.get("code_challenge") || "";
  const codeChallengeMethod = searchParams.get("code_challenge_method") || "";

  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: "invalid_request", error_description: "client_id and redirect_uri are required." }, { status: 400 });
  }

  const { data: client } = await OAuthClient.get({ clientId }).go();
  if (!client) {
    return NextResponse.json({ error: "invalid_client", error_description: "Unrecognized client_id." }, { status: 400 });
  }
  if (!client.redirectUris.includes(redirectUri)) {
    return NextResponse.json({ error: "invalid_request", error_description: "redirect_uri does not match a registered redirect URI for this client." }, { status: 400 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://plexo.charisol.io";
  const loginUrl = new URL(`${baseUrl}/mcp/login`);
  loginUrl.searchParams.set("client_id", clientId);
  loginUrl.searchParams.set("callbackUrl", redirectUri);
  if (state) loginUrl.searchParams.set("state", state);
  if (codeChallenge) loginUrl.searchParams.set("code_challenge", codeChallenge);
  if (codeChallengeMethod) loginUrl.searchParams.set("code_challenge_method", codeChallengeMethod);

  return NextResponse.redirect(loginUrl.toString());
}
