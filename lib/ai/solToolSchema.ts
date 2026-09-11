import { PLEXO_MCP_TOOLS } from "@/lib/mcp/dispatchMcpTool";

// Converts Plexo's MCP tool catalog into Anthropic/Bedrock "tool use" format for SOL's
// agent loop (lib/ai/solAgent.ts).
//
// Imported from lib/mcp/dispatchMcpTool.ts (NOT lib/mcp/mcpServer.ts, which re-exports the
// same PLEXO_MCP_TOOLS but also imports `next/server` for its own handleMcpJsonRpc route
// handler) so this file — part of SOL's Lambda bundle via lib/ai/solAgent.ts — never pulls
// next/server into that standalone esbuild bundle. See dispatchMcpTool.ts's own top-of-file
// comment for the full story.
//
// NOTE: PLEXO_MCP_TOOLS already spreads BLOG_MCP_TOOLS,
// COMMERCE_MCP_TOOLS, and LMS_MCP_TOOLS into itself (see the end of that array's
// definition: `...BLOG_MCP_TOOLS, ...COMMERCE_MCP_TOOLS, ...LMS_MCP_TOOLS`) — it is
// already the single combined catalog of every tool MCP clients see via tools/list, and
// every tool dispatchMcpTool can execute. Re-concatenating the per-domain arrays on top
// of it here would just duplicate every blog/commerce/LMS tool definition, so this only
// maps PLEXO_MCP_TOOLS itself.
export interface BedrockToolDef {
  name: string;
  description: string;
  input_schema: any;
}

export function getAllSolTools(): BedrockToolDef[] {
  return PLEXO_MCP_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
}
