import { describe, expect, it, vi } from "vitest";
import { buildPageFromTemplate, createDefaultDesignSystem } from "@charisol/plexo-sdk/v2/compile";

import { compileV2Design } from "@/lib/v2/compile";
import { V2_FORMAT } from "@/lib/v2/design";
import { packHtml, packJson, unpackHtml, unpackJson } from "@/lib/db/packed";
import { Template } from "@/lib/db/contentEntities";

vi.hoisted(() => {
  for (const n of ["CORE", "LEDGER", "COMMERCE", "CONTENT", "OPS", "IMPORT", "SOL"]) process.env[`PLEXO_${n}_TABLE`] ??= `test-${n}`;
});

// DynamoDB sizes an item by attribute names plus values; UTF-8 bytes of the marshalled values is a close, slightly generous stand-in.
const itemBytes = (item: Record<string, unknown>) =>
  Object.entries(item).reduce((n, [k, v]) => n + Buffer.byteLength(k) + Buffer.byteLength(typeof v === "string" ? v : JSON.stringify(v)), 0);

describe("packing", () => {
  it("round-trips big values and leaves small ones as they are", () => {
    const big = { format: V2_FORMAT, pages: [{ text: "x".repeat(50_000) }] };
    const packed = packJson(big) as { __packed?: string; format?: string };
    expect(packed.__packed).toBe("gz1");
    expect(packed.format).toBe(V2_FORMAT);
    expect(unpackJson(packed)).toEqual(big);
    const small = { format: V2_FORMAT, pages: [] };
    expect(packJson(small)).toBe(small);
    expect(unpackJson(small)).toBe(small);
    const html = "<p>" + "é".repeat(40_000) + "</p>";
    expect(unpackHtml(packHtml(html))).toBe(html);
    expect(packHtml("<p>hi</p>")).toBe("<p>hi</p>");
    expect(unpackHtml("<p>plain</p>")).toBe("<p>plain</p>");
  });
});

describe("a V2 Template row stays under DynamoDB's 400 KB item limit", () => {
  const sizes: string[] = [];
  for (const tpl of ["landing", "pricing"]) {
    it(`${tpl}: customised colours, live + unpublished copy`, () => {
      const ds = createDefaultDesignSystem();
      const page = buildPageFromTemplate(tpl, { name: "Home", slug: "home", designSystem: ds });
      const design = { format: V2_FORMAT, pages: [page], designSystem: ds };
      const html = compileV2Design(design, { name: "x", rootTemplateId: "t", templateId: "t" } as never);
      const params = Template.put({
        id: "t", userId: "u", organizationId: "o", kind: "LANDING_PAGE", name: "x", designJson: design, compiledHtml: html, draftJson: design, draftHtml: html, designFormat: "v2",
      } as never).params() as { Item: Record<string, unknown> };
      const bytes = itemBytes(params.Item);
      sizes.push(`${tpl}: ${(bytes / 1024).toFixed(0)} KB`);
      expect(bytes, `row is ${(bytes / 1024).toFixed(0)} KB`).toBeLessThan(150 * 1024);
    });
  }
});
