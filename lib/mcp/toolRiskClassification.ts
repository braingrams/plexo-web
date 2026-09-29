// Classifies which MCP tools (lib/mcp/mcpServer.ts's own PLEXO_MCP_TOOLS switch, plus
// blogTools.ts/commerceTools.ts/lmsTools.ts) are destructive or billing-affecting FOR THE
// END USER'S OWN CUSTOMERS — i.e. actions that permanently remove something, cut off a
// paying customer's access, or move real money — as opposed to Plexo's own AI-credit
// billing (that's a separate concern, gated by lib/credits/ledgerOperations.ts).
//
// SOL (lib/ai/solAgent.ts) uses this to force a human-in-the-loop confirmation step
// before actually invoking one of these tools on the user's behalf — see
// runAgentTurn's isDestructiveTool branch. Getting this list wrong in the "too narrow"
// direction is the real risk: an under-classified destructive tool would let SOL fire it
// without ever asking, silently deleting or refunding something on the user's behalf. So
// this list is deliberately generous — every tool that deletes, permanently removes, moves
// money, or revokes a paying customer's access is included, even when its own doc string
// describes it as a "soft" delete or reversible, since the immediate user-facing effect
// (a product stops selling, a customer loses access, funds are reserved) is still real.
//
// Cross-referenced against every tool definition in:
//   - lib/mcp/mcpServer.ts        (PLEXO_MCP_TOOLS' own entries, not the re-exported ones)
//   - lib/mcp/blogTools.ts        (BLOG_MCP_TOOLS)
//   - lib/mcp/commerceTools.ts    (COMMERCE_MCP_TOOLS)
//   - lib/mcp/lmsTools.ts         (LMS_MCP_TOOLS)
//
// Explicitly EXCLUDED, and why (so a future reviewer doesn't "fix" these back in without
// re-checking the reasoning):
//   - reset_blog_layout: doc string is explicit that the layout Template is NOT deleted —
//     purely a detach, fully reversible by calling design_blog_layout again.
//   - delete_funnel: doc string is explicit this is enabled:false only — pages,
//     enrollments, and progress are all kept and restored on re-enable.
//   - moderate_blog_comment: a status flip (PENDING/APPROVED/SPAM/REJECTED), not a delete.
//   - update_* / create_* tools in general: ordinary content edits/creation, not covered
//     here even when they overwrite existing content (e.g. update_template,
//     design_blog_layout, update_commerce_product) — reversible by a follow-up edit.
export const DESTRUCTIVE_TOOL_NAMES: ReadonlySet<string> = new Set([
  // --- lib/mcp/mcpServer.ts (core landing-page/template/domain tools) ---
  "delete_template", // permanently deletes a landing page or email template, cascades to sub-pages/assets/domain
  "delete_landing_page_page", // deletes a page (and cascades to its sub-pages); deleting a home page deletes the whole site
  "delete_published_domain", // unlinks/deletes a live published domain, taking the site offline at that domain

  // --- lib/mcp/blogTools.ts ---
  "delete_blog_post", // "Permanently deletes... Cannot be undone" per its own tool description
  "delete_blog_category", // permanently deletes the category
  "delete_blog_tag", // permanently deletes the tag
  "delete_blog_author", // permanently deletes the author/byline
  "delete_blog_comment", // permanently deletes a comment, cascading to its replies

  // --- lib/mcp/commerceTools.ts (real money / a real customer's purchase, not Plexo credits) ---
  "delete_commerce_product", // deactivates a product so it can no longer be bought
  "delete_commerce_delivery_method", // "Permanently deletes" a checkout delivery option
  "delete_commerce_discount", // "Permanently deletes" a discount code
  "refund_commerce_order", // moves real money back to a paying customer through Paystack
  "request_commerce_withdrawal", // reserves/moves real money out of the store's wallet immediately

  // --- lib/mcp/lmsTools.ts (Funnel/LMS) ---
  "delete_funnel_page", // deletes a funnel page outright (unlike delete_funnel, nothing here is soft/reversible)
  "set_funnel_enrollment_status", // can immediately revoke a paying learner's access to content they bought
]);

export function isDestructiveTool(toolName: string): boolean {
  return DESTRUCTIVE_TOOL_NAMES.has(toolName);
}
