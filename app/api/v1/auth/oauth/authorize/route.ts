import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/v1/auth/oauth/authorize
 *
 * Standard OAuth 2.0 Authorization Endpoint for Claude Web & Remote MCP Connectors.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("client_id") || "plexo_mcp_client";
  const redirectUri = searchParams.get("redirect_uri") || "";
  const state = searchParams.get("state") || "";

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://plexo.charisol.io";
  const loginUrl = new URL(`${baseUrl}/mcp/login`);

  if (redirectUri) {
    loginUrl.searchParams.set("callbackUrl", redirectUri);
  }
  if (state) {
    loginUrl.searchParams.set("state", state);
  }

  return NextResponse.redirect(loginUrl.toString());
}
