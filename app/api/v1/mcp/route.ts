import { NextRequest, NextResponse } from "next/server";
import { handleMcpJsonRpc, PLEXO_MCP_TOOLS } from "@/lib/mcp/mcpServer";
import { resolveUser } from "@/lib/auth/resolveUser";

export async function GET(request: NextRequest): Promise<Response> {
  const acceptHeader = request.headers.get("accept") || "";
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://plexo.charisol.io";

  // If client requests SSE streamable transport (e.g. Claude Web Remote MCP Connector) —
  // deliberately left unauthenticated: this only hands back an "endpoint" event pointing
  // back at this same URL, no account data, and the browser EventSource API most SSE
  // clients use can't attach a custom Authorization header to the initial handshake
  // anyway — real authorization happens on the JSON-RPC POST channel below.
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

  // The plain (non-SSE) GET is what a connector-setup UI's discovery probe most likely
  // hits first — previously this always returned 200 with the full tool catalog, with
  // no real 401 challenge anywhere, which is exactly why Claude's own "add custom
  // connector" flow detected this server as needing no authentication at all. A regular
  // HTTP GET can carry a Bearer/x-api-key header (unlike the SSE branch above), so this
  // is challenged the same way POST tools/call etc. are (see mcpServer.ts).
  const resolved = await resolveUser(request);
  if (!resolved) {
    // The real WWW-Authenticate header is added by CloudFront's own McpResponseHeadersPolicy
    // (see compute-stack.ts) on this route's dedicated behavior, not set here — a Lambda
    // Function URL origin can't send that header name directly (CloudFront error-classifies
    // and remaps it, then skips even a CloudFront Function trying to fix it up after the
    // fact — confirmed live). This response body still names it for any client inspecting
    // the JSON directly instead of the header.
    return NextResponse.json(
      { error: "authentication_required", error_description: "See WWW-Authenticate header." },
      { status: 401, headers: { "Access-Control-Allow-Origin": "*" } },
    );
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
