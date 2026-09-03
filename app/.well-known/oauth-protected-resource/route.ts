import { NextResponse } from "next/server";

// RFC 9728 OAuth 2.0 Protected Resource Metadata. This is what a client discovers from
// the WWW-Authenticate challenge on an unauthenticated request to /api/v1/mcp (see
// lib/mcp/mcpServer.ts) — it tells the client where the actual authorization server
// (this same app's /.well-known/oauth-authorization-server) lives. Previously /api/v1/mcp
// never issued a 401 at all, so nothing pointed a client here — Claude's own "add custom
// connector" flow detected "Authentication: None" as a result, since it never received a
// signal that OAuth was required.
export async function GET(): Promise<NextResponse> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://plexo.charisol.io";

  return NextResponse.json(
    {
      resource: `${baseUrl}/api/v1/mcp`,
      authorization_servers: [baseUrl],
      scopes_supported: ["user", "openid", "profile", "mcp"],
      bearer_methods_supported: ["header"],
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    },
  );
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
