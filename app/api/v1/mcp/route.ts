import { NextRequest, NextResponse } from "next/server";
import { handleMcpJsonRpc, PLEXO_MCP_TOOLS } from "@/lib/mcp/mcpServer";

export async function GET(request: NextRequest): Promise<Response> {
  const acceptHeader = request.headers.get("accept") || "";

  // If client requests SSE streamable transport (e.g. Claude Web Remote MCP Connector)
  if (acceptHeader.includes("text/event-stream")) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        // Send initial endpoint event
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://plexobuilder.com";
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

  // Return server info & tool catalog metadata
  return NextResponse.json({
    name: "Plexo MCP Server",
    version: "1.0.0",
    protocolVersion: "2024-11-05",
    tools: PLEXO_MCP_TOOLS,
  });
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
