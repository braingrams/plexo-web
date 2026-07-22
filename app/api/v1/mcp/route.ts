import { NextRequest, NextResponse } from "next/server";
import { handleMcpJsonRpc, PLEXO_MCP_TOOLS } from "@/lib/mcp/mcpServer";

export async function GET(request: NextRequest): Promise<Response> {
  const acceptHeader = request.headers.get("accept") || "";
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://plexo.charisol.io";

  // If client requests SSE streamable transport (e.g. Claude Web Remote MCP Connector)
  if (acceptHeader.includes("text/event-stream")) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        // Send initial endpoint event
        const message = `event: endpoint\ndata: ${baseUrl}/api/v1/mcp\n\n`;
        controller.enqueue(encoder.encode(message));
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // Return server info, capabilities, authentication endpoints & tool catalog metadata
  return NextResponse.json(
    {
      name: "Plexo MCP Server",
      version: "1.0.0",
      protocolVersion: "2024-11-05",
      authentication: {
        type: "oauth2",
        authorization_endpoint: `${baseUrl}/api/v1/auth/oauth/authorize`,
        token_endpoint: `${baseUrl}/api/v1/auth/oauth/token`,
        registration_endpoint: `${baseUrl}/api/v1/auth/oauth/register`,
        scopes_supported: ["user", "openid", "profile"],
      },
      capabilities: {
        tools: {},
        authentication: {
          oauth2: {
            authorizationUrl: `${baseUrl}/api/v1/auth/oauth/authorize`,
            tokenUrl: `${baseUrl}/api/v1/auth/oauth/token`,
          },
        },
      },
      tools: PLEXO_MCP_TOOLS,
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
      },
    }
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => ({}));
  return handleMcpJsonRpc(request, body);
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
    },
  });
}
