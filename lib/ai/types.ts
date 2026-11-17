export type AiActionMode =
  | "edit_element"
  | "edit_layout"
  | "generate_layout"
  | "edit_raw_html"
  // Generates a brand-new, complete, self-contained HTML document from a prompt — the
  // "premium, fully custom" counterpart to generate_layout's drag-and-drop builder output
  // (see NewSiteWizard.tsx's page-type toggle and SOL's own system prompt for the same
  // builder-vs-raw-HTML framing). Distinct from edit_raw_html, which only ever modifies an
  // EXISTING document and is worded accordingly — this one starts from nothing.
  | "generate_raw_html"
  | "generate_blog_post"
  // SOL, the AI agent chat feature (lib/ai/solAgent.ts) — one turn of a multi-turn,
  // tool-using conversation. See MAX_TOKENS below (lib/ai/generate.ts) for its output
  // ceiling and lib/credits/agentTurnEstimate.ts for how a whole agent turn (which may
  // call the model up to MAX_TOOL_ITERATIONS times) is pre-flight estimated.
  | "agent_chat"
  // Commerce's AI product import: reads a catalog file (CSV text or a PDF) and returns
  // product rows (app/api/v1/commerce/[templateId]/products/import-ai).
  | "import_products"
  // SOL inside the visual editor: one streamed answer (a few sentences plus section changes the
  // editor applies as they arrive) — lib/ai/pageAssist.ts.
  | "page_assist"
  // The SDK file editor rebuilding a picture (or a scanned PDF page) as editable text, boxes and photos —
  // app/api/v1/ai/image-to-design. One picture in, one JSON description out.
  | "image_to_design";

// `anthropic_claude` = direct Anthropic API (BYOK / Host-Managed AI modes, via
// lib/ai/providers/anthropic.ts). `bedrock_claude` = Amazon Bedrock (Plexo's own
// hosted System-tier AI agent traffic, via lib/ai/providers/bedrockClaude.ts) — a
// distinct, separately-addressable provider even though both ultimately call Claude.
export type AiProvider = "openai" | "anthropic_claude" | "google_gemini" | "bedrock_claude";

export type ConcreteTier = "BASIC" | "MEDIUM" | "HIGH";

export interface GenerateOutcome {
  summary: string;
  result: unknown;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}
