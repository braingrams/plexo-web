import { describe, expect, it } from "vitest";
import { filterConversations, greetingFor, groupConversationsByDay, parseSiteParam, siteContextFor, withSiteContext } from "@/app/dashboard/_v3/sol/logic";
import type { ConversationSummary } from "@/app/dashboard/sol/_components/types";

const conv = (id: string, at: string, title: string | null = id): ConversationSummary => ({ id, title, modelTier: "BASIC", status: "ACTIVE", lastMessageAt: at, messageCount: 2, createdAt: at, updatedAt: at });
const now = new Date(2026, 10, 17, 15, 0, 0); // 17 Nov, 3pm local
const at = (daysAgo: number, hour = 10) => new Date(2026, 10, 17 - daysAgo, hour).toISOString();

describe("grouping conversations by day", () => {
  it("puts each conversation in Today, Yesterday, the last week or Earlier, newest first", () => {
    const groups = groupConversationsByDay([conv("old", at(30)), conv("t1", at(0, 9)), conv("y", at(1, 23)), conv("t2", at(0, 14)), conv("w", at(5))], now);
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday", "Previous 7 days", "Earlier"]);
    expect(groups[0].items.map((c) => c.id)).toEqual(["t2", "t1"]);
    expect(groups[3].items.map((c) => c.id)).toEqual(["old"]);
  });
  it("leaves out empty groups", () => {
    expect(groupConversationsByDay([conv("a", at(0))], now).map((g) => g.id)).toEqual(["today"]);
    expect(groupConversationsByDay([], now)).toEqual([]);
  });
  it("treats just after midnight as today and just before as yesterday", () => {
    const g = groupConversationsByDay([conv("a", new Date(2026, 10, 17, 0, 1).toISOString()), conv("b", new Date(2026, 10, 16, 23, 59).toISOString())], now);
    expect(g.map((x) => [x.id, x.items[0].id])).toEqual([["today", "a"], ["yesterday", "b"]]);
  });
});

describe("searching conversations", () => {
  it("matches titles case-insensitively and shows all for a blank search", () => {
    const list = [conv("1", at(0), "Home page words"), conv("2", at(0), null)];
    expect(filterConversations(list, "HOME").map((c) => c.id)).toEqual(["1"]);
    expect(filterConversations(list, "new conv").map((c) => c.id)).toEqual(["2"]);
    expect(filterConversations(list, "  ")).toHaveLength(2);
  });
});

describe("the Working on chip", () => {
  it("only trusts a sensible id and finds the site", () => {
    expect(parseSiteParam("abc123XYZ")).toBe("abc123XYZ");
    expect(parseSiteParam(["abc123XYZ", "x"])).toBe("abc123XYZ");
    expect(parseSiteParam("../etc")).toBeNull();
    expect(parseSiteParam(undefined)).toBeNull();
    expect(siteContextFor([{ id: "abc123XYZ", name: "Ama's Kitchen" }], "abc123XYZ")).toEqual({ id: "abc123XYZ", name: "Ama's Kitchen" });
    expect(siteContextFor([{ id: "abc123XYZ", name: "x" }], "other-id-1")).toBeNull();
  });
  it("tells SOL which site, only when there is one", () => {
    expect(withSiteContext("Add a menu page", { id: "s1abcdef", name: "Ama's Kitchen" })).toContain("Ama's Kitchen");
    expect(withSiteContext("Hi", null)).toBe("Hi");
  });
});

describe("greeting", () => {
  it("follows the hour", () => {
    expect([3, 9, 14, 20].map(greetingFor)).toEqual(["Good night", "Good morning", "Good afternoon", "Good evening"]);
  });
});

import { friendlyStep } from "@/app/dashboard/_v3/sol/logic";
describe("steps in plain words", () => {
  it("never shows a tool's technical name", () => {
    expect(friendlyStep("create_raw_landing_page", "doing")).toBe("Building your page");
    expect(friendlyStep("create_raw_landing_page", "done")).toBe("Built your page");
    expect(friendlyStep("page_publish", "doing")).toBe("Publishing your page");
    expect(friendlyStep("list_commerce_products", "done")).toBe("Looked up your shop products");
    expect(friendlyStep("get_user_profile", "done")).toBe("Checked your account");
    expect(friendlyStep("create_blog_post", "done")).toBe("Built your blog post");
    expect(friendlyStep("mystery_thing", "done")).toBe("Mystery thing");
  });
});
