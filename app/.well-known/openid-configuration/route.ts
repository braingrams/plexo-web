import { NextResponse } from "next/server";

export async function GET(): Promise<NextResponse> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://plexo.charisol.io";

  return NextResponse.json(
    {
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/api/v1/auth/oauth/authorize`,
      token_endpoint: `${baseUrl}/api/v1/auth/oauth/token`,
      userinfo_endpoint: `${baseUrl}/api/v1/profile`,
      jwks_uri: `${baseUrl}/api/v1/auth/oauth/jwks`,
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      scopes_supported: ["openid", "profile", "email"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
      claims_supported: ["sub", "iss", "name", "email"],
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
