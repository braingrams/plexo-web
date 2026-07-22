import { NextResponse } from "next/server";

export async function GET(): Promise<NextResponse> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://plexo.charisol.io";

  return NextResponse.json(
    {
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/api/v1/auth/oauth/authorize`,
      token_endpoint: `${baseUrl}/api/v1/auth/oauth/token`,
      registration_endpoint: `${baseUrl}/api/v1/auth/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256", "plain"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
      scopes_supported: ["user", "openid", "profile", "mcp"],
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    }
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
