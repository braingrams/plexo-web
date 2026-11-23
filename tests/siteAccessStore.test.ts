import { beforeEach, describe, expect, it, vi } from "vitest";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const PAGE = "33333333-3333-4333-8333-333333333333";
const rows: Record<string, { id: string; organizationId: string; parentId?: string | null; kind: string }> = {
  [A]: { id: A, organizationId: "org1", kind: "LANDING_PAGE" },
  [B]: { id: B, organizationId: "org2", kind: "LANDING_PAGE" },
  [PAGE]: { id: PAGE, organizationId: "org1", parentId: A, kind: "LANDING_PAGE" },
};
vi.mock("@/lib/db/contentEntities", () => ({ Template: { get: ({ id }: { id: string }) => ({ go: async () => ({ data: rows[id] ?? null }) }) } }));
vi.mock("@/lib/db/coreEntities", () => ({ Member: { get: () => ({ go: async () => ({ data: null }) }) } }));

import { forgetSiteRoots, guestRoleForSite, rootOfTemplate, validateSiteAccess } from "@/lib/access/siteAccessStore";

beforeEach(() => forgetSiteRoots());

describe("choosing the sites for someone", () => {
  it("accepts this workspace's own sites with real roles", async () => {
    expect(await validateSiteAccess("org1", { [A]: "editor" })).toEqual({ ok: true, access: { [A]: "editor" } });
  });
  it("refuses a site from another workspace, a page, a made-up role and an empty list", async () => {
    expect((await validateSiteAccess("org1", { [B]: "editor" })).ok).toBe(false);
    expect((await validateSiteAccess("org1", { [PAGE]: "editor" })).ok).toBe(false);
    expect((await validateSiteAccess("org1", { [A]: "admin" })).ok).toBe(false);
    expect((await validateSiteAccess("org1", {})).ok).toBe(false);
    expect((await validateSiteAccess("org1", null)).ok).toBe(false);
  });
});

describe("which site a page belongs to", () => {
  it("a page's role comes from its site", async () => {
    expect(await rootOfTemplate(PAGE)).toEqual({ root: A, organizationId: "org1" });
    expect(await guestRoleForSite({ [A]: "blogger" }, PAGE, "org1")).toEqual({ role: "blogger", root: A });
  });
  it("is nothing for a site they weren't given, or one in another workspace", async () => {
    expect(await guestRoleForSite({ [A]: "editor" }, B, "org1")).toBeNull();
    expect(await guestRoleForSite({ [B]: "editor" }, B, "org1")).toBeNull();
  });
});
