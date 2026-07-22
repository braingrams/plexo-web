import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/v1/auth/oauth/register
 *
 * Dynamic Client Registration endpoint for ChatGPT & OAuth clients.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => ({}));
  const clientName = body.client_name || "ChatGPT MCP Client";

  return NextResponse.json(
    {
      client_id: "plexo_mcp_client",
      client_secret: "plexo_mcp_secret",
      client_name: clientName,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
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
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
