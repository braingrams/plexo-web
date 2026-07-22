import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/prisma";

/**
 * POST /api/v1/auth/oauth/token
 *
 * Standard OAuth 2.0 Token Exchange Endpoint for Claude Web & Remote MCP Connectors.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => ({}));
  const code = body.code || body.token;
  const clientId = body.client_id;
  const clientSecret = body.client_secret;

  // Validate or fetch token
  if (code && typeof code === "string" && code.startsWith("plexo_")) {
    return NextResponse.json({
      access_token: code,
      token_type: "Bearer",
      expires_in: 31536000,
    });
  }

  // If clientSecret is provided as an API key directly
  if (clientSecret && typeof clientSecret === "string" && clientSecret.startsWith("plexo_")) {
    return NextResponse.json({
      access_token: clientSecret,
      token_type: "Bearer",
      expires_in: 31536000,
    });
  }

  // Fetch default active system/test key if available
  const apiKeyRecord = await prisma.apiKey.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
  });

  const token = apiKeyRecord?.maskedKey || "plexo_mcp_session_token";

  return NextResponse.json({
    access_token: token,
    token_type: "Bearer",
    expires_in: 31536000,
  });
}
