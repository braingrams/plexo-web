/**
 * Who may ask SOL (or any MCP client) to do what. Every tool call passes through authorizeToolCall before it runs.
 *
 * The account boundary was already enforced inside each tool (a record has to belong to the caller's organisation). What was missing
 * is the PERSON's role: the dashboard screens refuse a view-only teammate a change, a blog-only teammate a refund, an editor a page
 * they were not given, but SOL acted with the whole account's power for anyone who could open the chat. This puts the same rules, from
 * the same role table (server/accessControl.ts), in front of every tool:
 *
 *   - Reading something needs a role that can work with that area (a blogger cannot ask SOL for the customer list).
 *   - Changing it needs the matching permission (create / update / delete / publish).
 *   - Taking money out of the store's wallet is for the owner and admins only.
 *   - An editor limited to certain pages can only touch those pages.
 *   - API keys (no role) keep working as before: they are the owner's own key.
 *
 * Pure: the tool lists are passed in, so this is easy to test and cannot drift from the real tool names without a test failing.
 */
import { roles, type OrgRole } from "@/server/accessControl";

export type ToolResource = "template" | "blog" | "commerce" | "lms" | "domain";
export type ToolAction = "read" | "create" | "update" | "delete" | "publish" | "withdraw";
export type ToolNeed = { resource: ToolResource; action: ToolAction };

export type ToolGroups = { blog: ReadonlySet<string>; commerce: ReadonlySet<string>; lms: ReadonlySet<string> };

const READ_PREFIX = /^(get|list|find|check|preview|describe)_/;
// Only a name that says so is a read. (A suffix like "_status" is NOT: set_funnel_enrollment_status changes what a learner can open.)
const READ_SUFFIX = /_(describe|get)$/;
const APP_READS = new Set(["app_status", "app_list_files", "app_read_files", "app_versions", "app_runtime_errors", "app_function_logs", "app_db_schema", "app_screenshot", "app_design_describe", "app_find_photos", "app_build_status"]);

/** What a tool needs, from its name and the area it belongs to. */
export function toolNeed(name: string, groups: ToolGroups): ToolNeed {
  const resource: ToolResource = groups.blog.has(name) ? "blog" : groups.commerce.has(name) ? "commerce" : groups.lms.has(name) ? "lms" : /domain/.test(name) ? "domain" : "template";
  if (name === "request_commerce_withdrawal") return { resource: "commerce", action: "withdraw" };
  if (READ_PREFIX.test(name) || READ_SUFFIX.test(name) || APP_READS.has(name)) return { resource, action: "read" };
  if (name.startsWith("delete_") || name === "app_delete_files") return { resource, action: "delete" };
  if (/publish/.test(name)) return { resource, action: "publish" };
  if (/^(create|add|sell|start|connect|import|adopt|duplicate)_/.test(name)) return { resource, action: "create" };
  return { resource, action: "update" };
}

const ROLE_LABEL: Record<string, string> = { owner: "an owner", admin: "an admin", editor: "an editor", blogger: "a blogger", commenter: "a commenter", viewer: "a viewer" };
const AREA: Record<ToolResource, string> = { template: "pages and the site", blog: "the blog", commerce: "the shop", lms: "courses", domain: "web addresses" };

/** Only owners and admins can take money out of the wallet. API keys (no role) are the owner's own. */
export function canWithdrawMoney(role: OrgRole | null): boolean {
  return role === null || role === "owner" || role === "admin";
}

export type ScopeMember = { role?: string | null; scopedTemplateIds?: readonly string[] | null } | null | undefined;

/**
 * Returns a plain-words refusal, or null when the call may go ahead. `member` is only needed for editors (to honour the pages they
 * were limited to).
 */
export function authorizeToolCall(input: { role: OrgRole | null; toolName: string; args: Record<string, unknown> | null | undefined; groups: ToolGroups; member?: ScopeMember }): string | null {
  const { role, toolName, groups } = input;
  if (role === null) return null; // an API key
  const need = toolNeed(toolName, groups);
  const who = ROLE_LABEL[role] ?? "a team member";
  const defined = roles[role];
  if (!defined) return "You don't have permission to do that.";
  const statements = defined.statements as Record<string, readonly string[]>;

  if (need.action === "withdraw") {
    return canWithdrawMoney(role) ? null : `Only the account owner or an admin can take money out of the shop. You are signed in as ${who}.`;
  }
  if (need.action === "read") {
    const hasArea = (statements[need.resource]?.length ?? 0) > 0;
    // Viewers and commenters are there to look at pages and comment, so they may read pages (never the shop or customers).
    const lookOnly = need.resource === "template" && (role === "viewer" || role === "commenter");
    return hasArea || lookOnly ? null : `You can't see ${AREA[need.resource]} as ${who}. Ask the account owner for access.`;
  }
  if (!statements[need.resource]?.includes(need.action)) {
    const verb = need.action === "delete" ? "delete things in" : need.action === "publish" ? "publish" : need.action === "create" ? "add to" : "change";
    return `You can't ${verb} ${AREA[need.resource]} as ${who}. Ask the account owner for access.`;
  }
  // An editor limited to certain pages can only change those pages (the same rule the page editor uses).
  const scope = input.member?.role === "editor" ? input.member.scopedTemplateIds ?? [] : [];
  if (need.resource === "template" && scope.length > 0) {
    const ids = ["templateId", "pageId", "id", "siteId"].map((k) => input.args?.[k]).filter((v): v is string => typeof v === "string" && v.length > 0);
    if (ids.length === 0 || ids.some((id) => !scope.includes(id))) return "You can only change the pages you were given access to.";
  }
  return null;
}
