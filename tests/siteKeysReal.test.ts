import { describe, expect, it, vi } from "vitest";

// The purge must query the keys ElectroDB really writes. This builds them from the REAL
// entity definitions (no database is touched — only .params()) and checks them against
// the format actually stored on staging: "template#<id>", "post#<id>", "product#<id>".
vi.hoisted(() => {
  for (const t of ["CORE", "LEDGER", "COMMERCE", "CONTENT", "OPS", "IMPORT", "SOL"]) process.env[`PLEXO_${t}_TABLE`] = `test-${t.toLowerCase()}`;
});
vi.mock("@/lib/storage", () => ({ deleteObjects: vi.fn() }));

import { siteKeys } from "@/lib/sites/purgeSiteData";

describe("a deleted site's data is looked up under the keys DynamoDB really holds", () => {
  it("site partitions, a post's comments and a product's related links", () => {
    expect(siteKeys.content("2397ef03-0216-4be7-939d-76d08a2ccce6")).toBe("template#2397ef03-0216-4be7-939d-76d08a2ccce6");
    expect(siteKeys.commerce("site1")).toBe("template#site1");
    expect(siteKeys.ops("site1")).toBe("template#site1");
    expect(siteKeys.import("site1")).toBe("template#site1");
    expect(siteKeys.postComments("4b00f9fd")).toBe("post#4b00f9fd");
    expect(siteKeys.productRelations("pr1")).toBe("product#pr1");
  });
});
