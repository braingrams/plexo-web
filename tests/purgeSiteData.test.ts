import { beforeEach, describe, expect, it, vi } from "vitest";

// A tiny in-memory DynamoDB: table → rows. Query by pk, batch delete (first call leaves
// one item unprocessed, like a throttled DynamoDB does).
const { db, s3 } = vi.hoisted(() => ({ db: new Map<string, { pk: string; sk: string; __edb_e__: string; id?: string; blobUrl?: string }[]>(), s3: [] as string[] }));
let throttledOnce = false;
vi.mock("@/lib/db/client", () => ({
  TABLES: { content: "content", commerce: "commerce", ops: "ops", import: "import" },
  docClient: {
    query: vi.fn(async ({ TableName, ExpressionAttributeValues }: { TableName: string; ExpressionAttributeValues: Record<string, string> }) => ({
      Items: (db.get(TableName) ?? []).filter((r) => r.pk === ExpressionAttributeValues[":pk"]),
    })),
    batchWrite: vi.fn(async ({ RequestItems }: { RequestItems: Record<string, { DeleteRequest: { Key: { pk: string; sk: string } } }[]> }) => {
      const [table, reqs] = Object.entries(RequestItems)[0];
      expect(reqs.length).toBeLessThanOrEqual(25);
      const process = throttledOnce ? reqs : reqs.slice(1);
      const unprocessed = throttledOnce ? [] : reqs.slice(0, 1);
      throttledOnce = true;
      db.set(table, (db.get(table) ?? []).filter((r) => !process.some((q) => q.DeleteRequest.Key.pk === r.pk && q.DeleteRequest.Key.sk === r.sk)));
      return { UnprocessedItems: unprocessed.length ? { [table]: unprocessed } : {} };
    }),
  },
}));
vi.mock("@/lib/storage", () => ({ deleteObjects: vi.fn(async (urls: string[]) => void s3.push(...urls)) }));
const subs = vi.hoisted(() => ({ list: [] as { status: string }[] }));
vi.mock("@/lib/db/commerceEntities", () => ({
  CommerceDonationSubscription: { query: { primary: () => ({ go: async () => ({ data: subs.list }) }) } },
  CommerceSettings: { get: () => ({ go: async () => ({ data: { productDetailTemplateId: "layout-product" } }) }) },
}));
vi.mock("@/lib/db/contentEntities", () => ({ BlogSite: { get: () => ({ go: async () => ({ data: { listingLayoutTemplateId: "layout-list", postLayoutTemplateId: "layout-post" } }) }) } }));

import { purgeSiteData, siteDeletionBlocker, siteLayoutTemplateIds } from "@/lib/sites/purgeSiteData";

const T = "TEMPLATE#site1";
beforeEach(() => {
  throttledOnce = false;
  s3.length = 0;
  subs.list = [];
  db.clear();
  const posts = Array.from({ length: 60 }, (_, i) => ({ pk: T, sk: `POST#p${i}`, __edb_e__: "blogPost", id: `post${i}` }));
  db.set("content", [
    { pk: T, sk: "TEMPLATE", __edb_e__: "template" },
    { pk: T, sk: "ASSET#a.css", __edb_e__: "templateAsset" },
    { pk: T, sk: "BLOGSITE", __edb_e__: "blogSite" },
    ...posts,
    { pk: "POST#post3", sk: "COMMENT#APPROVED#x#c1", __edb_e__: "blogComment" },
    { pk: "TEMPLATE#page2", sk: "REVISION#1", __edb_e__: "templateRevision" },
    { pk: "TEMPLATE#other-site", sk: "POST#keep", __edb_e__: "blogPost", id: "other" },
  ]);
  db.set("commerce", [
    { pk: T, sk: "PRODUCT#pr1", __edb_e__: "commerceProduct", id: "pr1" },
    { pk: T, sk: "SETTINGS", __edb_e__: "commerceSettings" },
    { pk: T, sk: "ORDER#o1", __edb_e__: "commerceOrder" },
    { pk: T, sk: "ORDER#o1#ITEM#i1", __edb_e__: "commerceOrderItem" },
    { pk: "PRODUCT#pr1", sk: "RELATED#pr2", __edb_e__: "commerceProductRelation" },
  ]);
  db.set("ops", [{ pk: T, sk: "SUBMISSION#1#s1", __edb_e__: "formSubmission" }, { pk: T, sk: "FORMSETTINGS#News", __edb_e__: "formSettings" }]);
  db.set("import", [{ pk: T, sk: "MEDIAMAP#https://wp/a.jpg", __edb_e__: "importMediaMap", blobUrl: "https://bucket/public/blog-import/site1/abc.jpg" }]);
});

describe("deleting a site deletes what it owns", () => {
  it("blog, comments, catalogue, settings, forms, imports and page revisions go; orders and the site's own records stay for the delete route", async () => {
    await purgeSiteData("site1", ["page2"]);
    const left = (t: string) => (db.get(t) ?? []).map((r) => `${r.pk}|${r.sk}`).sort();
    expect(left("content")).toEqual(["TEMPLATE#other-site|POST#keep", `${T}|ASSET#a.css`, `${T}|TEMPLATE`].sort());
    expect(left("commerce")).toEqual([`${T}|ORDER#o1`, `${T}|ORDER#o1#ITEM#i1`].sort());
    expect(left("ops")).toEqual([]);
    expect(left("import")).toEqual([]);
    expect(s3).toEqual(["https://bucket/public/blog-import/site1/abc.jpg"]);
  });

  it("refuses while monthly donors are still being charged", async () => {
    subs.list = [{ status: "ACTIVE" }, { status: "CANCELLED" }];
    expect(await siteDeletionBlocker("site1")).toMatch(/1 monthly donor\. Cancel their monthly gifts/);
    subs.list = [{ status: "CANCELLED" }];
    expect(await siteDeletionBlocker("site1")).toBeNull();
  });

  it("knows the layout pages that sit outside the site's page tree", async () => {
    expect((await siteLayoutTemplateIds("site1")).sort()).toEqual(["layout-list", "layout-post", "layout-product"]);
  });
});
