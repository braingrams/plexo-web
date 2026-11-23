import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { authorizeToolCall, canWithdrawMoney, toolNeed, type ToolGroups } from "@/lib/mcp/toolAuthorization";
import { DESTRUCTIVE_TOOL_NAMES } from "@/lib/mcp/toolRiskClassification";

// The real tool names, read from the source files, so a new tool cannot slip through unclassified.
const names = (file: string): Set<string> => {
  const text = fs.readFileSync(path.join(process.cwd(), "lib/mcp", file), "utf8");
  return new Set([...text.matchAll(/^\s*name: "([a-z0-9_]+)",/gm)].map((m) => m[1]));
};
const groups: ToolGroups = { blog: names("blogTools.ts"), commerce: new Set([...names("commerceTools.ts"), ...names("donationTools.ts")]), lms: names("lmsTools.ts") };
const call = (role: Parameters<typeof authorizeToolCall>[0]["role"], toolName: string, args: Record<string, unknown> = {}, member?: Parameters<typeof authorizeToolCall>[0]["member"]) => authorizeToolCall({ role, toolName, args, groups, member });

describe("what a tool needs", () => {
  it("finds the tools of each area", () => {
    expect(groups.blog.size).toBeGreaterThan(5);
    expect(groups.commerce.has("request_commerce_withdrawal")).toBe(true);
    expect(groups.lms.size).toBeGreaterThan(3);
  });
  it("reads, creates, changes, publishes, deletes and withdraws are told apart", () => {
    expect(toolNeed("list_commerce_orders", groups)).toEqual({ resource: "commerce", action: "read" });
    expect(toolNeed("get_blog_post", groups)).toEqual({ resource: "blog", action: "read" });
    expect(toolNeed("create_blog_post", groups)).toEqual({ resource: "blog", action: "create" });
    expect(toolNeed("update_commerce_product", groups)).toEqual({ resource: "commerce", action: "update" });
    expect(toolNeed("delete_template", groups)).toEqual({ resource: "template", action: "delete" });
    expect(toolNeed("publish_landing_page", groups)).toEqual({ resource: "template", action: "publish" });
    expect(toolNeed("delete_published_domain", groups)).toEqual({ resource: "domain", action: "delete" });
    expect(toolNeed("request_commerce_withdrawal", groups)).toEqual({ resource: "commerce", action: "withdraw" });
  });
  it("every tool SOL asks the owner to confirm as destructive is never treated as a read", () => {
    for (const name of DESTRUCTIVE_TOOL_NAMES) expect(toolNeed(name, groups).action, name).not.toBe("read");
  });
});

describe("who may ask SOL to do it", () => {
  it("API keys keep working as the owner's own", () => {
    expect(call(null, "request_commerce_withdrawal")).toBeNull();
    expect(call(null, "delete_template")).toBeNull();
  });

  it("a viewer can look at pages but change nothing and see no shop data", () => {
    expect(call("viewer", "list_landing_pages")).toBeNull();
    expect(call("viewer", "update_landing_page_page")).toMatch(/can't change/);
    expect(call("viewer", "delete_template")).toMatch(/can't delete/);
    expect(call("viewer", "list_commerce_customers")).toMatch(/can't see the shop/);
    expect(call("viewer", "request_commerce_withdrawal")).toMatch(/owner or an admin/);
  });

  it("a blogger can write the blog and nothing else", () => {
    expect(call("blogger", "create_blog_post")).toBeNull();
    expect(call("blogger", "list_blog_posts")).toBeNull();
    expect(call("blogger", "update_landing_page_page")).toMatch(/can't change pages/);
    expect(call("blogger", "list_commerce_orders")).toMatch(/can't see the shop/);
    expect(call("blogger", "refund_commerce_order")).toMatch(/can't/);
  });

  it("a commenter can read pages but not change anything", () => {
    expect(call("commenter", "list_landing_pages")).toBeNull();
    expect(call("commenter", "create_blog_post")).toMatch(/can't/);
  });

  it("an editor can work on pages, the shop and the blog, but not move money or manage addresses", () => {
    expect(call("editor", "update_landing_page_page")).toBeNull();
    expect(call("editor", "update_commerce_product")).toBeNull();
    expect(call("editor", "create_blog_post")).toBeNull();
    expect(call("editor", "request_commerce_withdrawal")).toMatch(/owner or an admin/);
    expect(call("editor", "delete_published_domain")).toMatch(/can't delete things in web addresses/);
  });

  it("owners and admins can take money out; nobody else can", () => {
    expect(canWithdrawMoney("owner")).toBe(true);
    expect(canWithdrawMoney("admin")).toBe(true);
    expect(canWithdrawMoney(null)).toBe(true);
    for (const r of ["editor", "blogger", "commenter", "viewer"] as const) expect(canWithdrawMoney(r), r).toBe(false);
    expect(call("owner", "request_commerce_withdrawal")).toBeNull();
    expect(call("admin", "request_commerce_withdrawal")).toBeNull();
  });

  it("an editor limited to some pages can only change those pages", () => {
    const member = { role: "editor", scopedTemplateIds: ["page-a"] };
    expect(call("editor", "update_landing_page_page", { templateId: "page-a" }, member)).toBeNull();
    expect(call("editor", "update_landing_page_page", { templateId: "page-b" }, member)).toMatch(/pages you were given/);
    expect(call("editor", "update_landing_page_page", {}, member)).toMatch(/pages you were given/);
    expect(call("editor", "update_landing_page_page", { templateId: "page-b" }, { role: "editor", scopedTemplateIds: [] })).toBeNull(); // no limit set
    expect(call("editor", "list_landing_pages", {}, member)).toBeNull(); // looking is not limited
  });
});
