import { describe, expect, it } from "vitest";
import { coerceToolArgs } from "@/lib/mcp/coerceArgs";

// Staging, telly: SOL sent app_write_files' `files` and app_edit_file's `edits` as JSON text,
// got "No files were given to save" / "No edits were given", and spent five paid rounds.

const writeSchema = { properties: { appId: { type: "string" }, files: { type: "array" } } };
const editSchema = { properties: { appId: { type: "string" }, path: { type: "string" }, edits: { type: "array" } } };

describe("tool arguments sent as JSON text", () => {
  it("unwraps a list sent as text", () => {
    const files = [{ path: "src/pages/Index.tsx", content: "export default function Index() {}\n" }];
    expect(coerceToolArgs({ appId: "a1", files: JSON.stringify(files) }, writeSchema)).toEqual({ appId: "a1", files });
    const edits = [{ find: "a", replace: "b" }];
    expect(coerceToolArgs({ appId: "a1", path: "x.ts", edits: ` ${JSON.stringify(edits)} ` }, editSchema)).toMatchObject({ edits });
  });

  it("unwraps an object sent as text", () => {
    expect(coerceToolArgs({ design: '{"rows":[]}' }, { properties: { design: { type: "object" } } })).toEqual({ design: { rows: [] } });
  });

  it("leaves strings that are meant to be strings, and bad JSON, alone", () => {
    expect(coerceToolArgs({ appId: "[not a list]" }, writeSchema)).toEqual({ appId: "[not a list]" });
    expect(coerceToolArgs({ files: "[{broken" }, writeSchema)).toEqual({ files: "[{broken" });
    expect(coerceToolArgs({ files: '{"path":"x"}' }, writeSchema)).toEqual({ files: '{"path":"x"}' }); // object where a list is wanted
  });

  it("passes proper arguments through untouched", () => {
    const args = { appId: "a1", files: [{ path: "a", content: "b" }] };
    expect(coerceToolArgs(args, writeSchema)).toEqual(args);
    expect(coerceToolArgs(args, undefined)).toBe(args);
  });
});
