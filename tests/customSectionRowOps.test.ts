import { describe, expect, it } from "vitest";
import { applyRowOps } from "@/lib/customSections/rowOps";

const fields = [
  { key: "heading", label: "Heading", type: "text" },
  { key: "items", label: "People", type: "list", itemName: "person", limit: 4, item: [{ key: "name", label: "Name", type: "text" }] },
];
const content = { heading: "Team", items: [{ _key: "a", name: "Ada" }, { _key: "b", name: "Bo" }] };
const ok = (r: ReturnType<typeof applyRowOps>) => ("value" in r ? r.value : (() => { throw new Error(r.error); })());

describe("row edits for the AI tools", () => {
  it("sets fields and single cells without touching the original", () => {
    const out = ok(applyRowOps(fields, content, { content: { heading: "Us", "items.1.name": "Bobby" } })) as typeof content;
    expect(out.heading).toBe("Us");
    expect(out.items[1].name).toBe("Bobby");
    expect(content.items[1].name).toBe("Bo");
  });
  it("adds, removes, moves and duplicates rows", () => {
    expect((ok(applyRowOps(fields, content, { addRows: { field: "items", rows: [{ name: "Cy" }], at: 0 } })) as typeof content).items.map((r) => r.name)).toEqual(["Cy", "Ada", "Bo"]);
    expect((ok(applyRowOps(fields, content, { removeRows: { field: "items", indexes: [0] } })) as typeof content).items.map((r) => r.name)).toEqual(["Bo"]);
    expect((ok(applyRowOps(fields, content, { moveRow: { field: "items", from: 0, to: 1 } })) as typeof content).items.map((r) => r.name)).toEqual(["Bo", "Ada"]);
    const dup = (ok(applyRowOps(fields, content, { duplicateRow: { field: "items", index: 0 } })) as typeof content).items;
    expect(dup.map((r) => r.name)).toEqual(["Ada", "Ada", "Bo"]);
    expect(dup[1]).not.toHaveProperty("_key");
  });
  it("explains problems in plain words", () => {
    expect(applyRowOps(fields, content, { addRows: { field: "nope", rows: [{}] } })).toMatchObject({ error: expect.stringMatching(/no repeating group/) });
    expect(applyRowOps(fields, content, { removeRows: { field: "items", indexes: [5] } })).toMatchObject({ error: expect.stringMatching(/between 0 and 1/) });
    expect(applyRowOps(fields, content, { addRows: { field: "items", rows: [{}, {}, {}] } })).toMatchObject({ error: expect.stringMatching(/at most 4/) });
    expect(applyRowOps(fields, content, { content: { "items.9.name": "x" } })).toMatchObject({ error: expect.stringMatching(/start at 0/) });
  });
});
