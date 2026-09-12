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

/** SOL's one non-MCP, non-business "meta" tool — asking the user a structured clarifying
 * question through the chat UI's interactive card (see AskUserQuestionCard.tsx) instead of
 * writing several questions out as a wall of plain text (the behavior this was added to
 * replace — see solAgent.ts's system prompt for the model-facing framing). Deliberately
 * kept OUT of PLEXO_MCP_TOOLS: it has no real dispatchMcpTool implementation and never will
 * — the agent loop (lib/ai/solAgent.ts) intercepts a call to this exact name before it ever
 * reaches dispatchMcpTool, the same way it already intercepts destructive tools, just
 * routed to a "collect answers" pause instead of a "confirm/decline" one. */
export const ASK_USER_QUESTION_TOOL_NAME = "ask_user_question";

const askUserQuestionTool: BedrockToolDef = {
  name: ASK_USER_QUESTION_TOOL_NAME,
  description:
    "Ask the user one or more clarifying questions through a structured, interactive prompt, instead of writing the questions out as plain text in your reply. Use this whenever a request is genuinely ambiguous and you need to ask more than one thing, or want to offer concrete choices instead of an open-ended question. Each question can carry 2-4 short options — the interface automatically also lets the user type their own free-text answer instead, so never add an \"Other\"/\"something else\"/\"none of these\" option yourself. Ask at most 4 questions in one call. Don't use this for a single obvious yes/no — just ask in plain text, or (for a destructive/irreversible action) let the normal confirmation gate handle it. Only put multiple questions in ONE call if they're genuinely independent of each other's answers — if question 2 should really depend on how question 1 gets answered (different follow-ups for different answers), ask question 1 alone, wait for the real answer, then call this tool again for question 2 informed by it. Don't pre-plan a fixed multi-question sequence that ignores what the user actually answers along the way.",
  input_schema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        minItems: 1,
        maxItems: 4,
        items: {
          type: "object",
          properties: {
            question: { type: "string", description: "The full question to ask, ending in a question mark." },
            header: { type: "string", description: "A very short label (2-3 words max) for this question, shown as a small tag." },
            options: {
              type: "array",
              minItems: 2,
              maxItems: 4,
              items: {
                type: "object",
                properties: {
                  label: { type: "string", description: "Short (1-6 words) option text." },
                  description: { type: "string", description: "Optional one-line clarification shown under the option." },
                },
                required: ["label"],
              },
            },
            multiSelect: { type: "boolean", description: "True if more than one option can be selected at once. Defaults to false." },
          },
          required: ["question", "header", "options"],
        },
      },
    },
    required: ["questions"],
  },
};

export function getAllSolTools(): BedrockToolDef[] {
  return [
    ...PLEXO_MCP_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    })),
    askUserQuestionTool,
  ];
}
