import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { revalidateBlogPost } from "@/lib/blog/revalidateDynamo";

// dispatchMcpTool (the full MCP tool-dispatch switch), the PLEXO_MCP_TOOLS catalog, and the
// ResolvedUser type now live in ./dispatchMcpTool.ts, which has NO `next/server` import
// anywhere in its own module or its import graph — this file (mcpServer.ts) still imports
// { NextRequest, NextResponse } from "next/server" for handleMcpJsonRpc below (the real
// Next.js API route handler for /api/v1/mcp), and esbuild bundles a whole module's imports
// regardless of which export is actually used. That broke SOL's standalone Lambda bundle
// (lambda/sol-chat/index.ts -> lib/ai/solAgent.ts -> dispatchMcpTool, AND -> lib/ai/
// solToolSchema.ts -> PLEXO_MCP_TOOLS) when both lived in this same file. See
// dispatchMcpTool.ts's own top-of-file comment for the full story. Re-exported here so every
// existing import of dispatchMcpTool/PLEXO_MCP_TOOLS/ResolvedUser from "@/lib/mcp/mcpServer"
// (this file, e.g. app/api/v1/mcp/route.ts) keeps working unchanged; lib/ai/solAgent.ts and
// lib/ai/solToolSchema.ts have been updated to import directly from
// "@/lib/mcp/dispatchMcpTool" instead, so SOL's own import graph never touches this file.
export { dispatchMcpTool, PLEXO_MCP_TOOLS, type ResolvedUser } from "./dispatchMcpTool";

import { dispatchMcpTool, PLEXO_MCP_TOOLS } from "./dispatchMcpTool";

export async function handleMcpJsonRpc(request: NextRequest, body: any): Promise<NextResponse> {
  const jsonrpc = body?.jsonrpc || "2.0";
  const id = body?.id ?? null;
  const method = body?.method;

  // Every method below needs a specific user/org's data — there's no anonymous
  // capability worth exposing here — so auth is checked once, up front, for all of them.
  // Previously only tools/call checked auth at all, and even then it returned HTTP 200
  // with the auth failure buried inside a JSON-RPC result (isError: true) instead of a
  // real 401. Per the MCP Authorization spec, a client only knows to start the OAuth
  // flow when it receives an actual 401 with a WWW-Authenticate challenge pointing at
  // this resource's protected-resource metadata — a 200 with an error message in the
  // payload gives it nothing to act on, which is exactly why Claude's own "add custom
  // connector" flow detected this server as requiring no authentication at all. The
  // header itself is added by CloudFront's own McpResponseHeadersPolicy on this route's
  // dedicated behavior (see compute-stack.ts), not here — a Lambda Function URL origin
  // can't send that header name directly (CloudFront error-classifies and remaps it,
  // then skips even a CloudFront Function trying to fix it up after the fact).
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json(
      {
        jsonrpc,
        id,
        error: { code: -32001, message: "Authentication required. See WWW-Authenticate header." },
      },
      { status: 401 },
    );
  }

  // 1. Handle initialize handshake
  if (method === "initialize") {
    return NextResponse.json({
      jsonrpc,
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "Plexo MCP Server",
          version: "1.0.0",
        },
      },
    });
  }

  // 2. Handle tools/list
  if (method === "tools/list") {
    return NextResponse.json({
      jsonrpc,
      id,
      result: {
        tools: PLEXO_MCP_TOOLS,
      },
    });
  }

  // 3. Handle tools/call
  if (method === "tools/call") {
    const toolName = body?.params?.name;
    const args = body?.params?.arguments || {};

    try {
      // Passes the real revalidateBlogPost (this file already has next/server, so next/cache
      // costs nothing extra here) so blog-write tools keep revalidating exactly as before
      // dispatchMcpTool/blogTools.ts were split to stay next/*-free for SOL's Lambda bundle
      // — see dispatchMcpTool.ts's own comment on its optional `revalidateBlogPost` param.
      const toolResult = await dispatchMcpTool(toolName, args, resolved, revalidateBlogPost);

      return NextResponse.json({
        jsonrpc,
        id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(toolResult, null, 2),
            },
          ],
        },
      });
    } catch (err: any) {
      return NextResponse.json({
        jsonrpc,
        id,
        result: {
          content: [
            {
              type: "text",
              text: `Error executing ${toolName}: ${err.message || String(err)}`,
            },
          ],
          isError: true,
        },
      });
    }
  }

  return NextResponse.json({
    jsonrpc,
    id,
    error: {
      code: -32601,
      message: "Method not found",
    },
  });
}
