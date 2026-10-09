import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseBuildError, parseTscOutput, parseNpmError } from "@/lib/projects/diagnostics";

// Real Vite 8 / Rolldown errors, captured from the project scaffold with the working
// directory rewritten to /work/app.
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/viteBuildErrors.json", import.meta.url), "utf8"));
const ROOT = "/work/app";

describe("parseBuildError", () => {
  it("names the file, 1-based position, and the fix for a missing local import", () => {
    const [d] = parseBuildError(fixtures.missingImport, ROOT);
    expect(d).toMatchObject({ kind: "build", file: "src/pages/Index.tsx", line: 1, column: 17 });
    expect(d.message).toContain("Could not resolve './Nope'");
    expect(d.message).toContain("doesn't exist");
    expect(d.snippet).toContain('import Foo from "./Nope"');
  });

  it("finds the file of a syntax error from the code frame header", () => {
    const [d] = parseBuildError(fixtures.syntax, ROOT);
    expect(d.file).toBe("src/pages/Index.tsx");
    expect(d.line).toBe(1);
    expect(d.message).toMatch(/Unexpected token/);
    expect(d.message).not.toContain("builtin:vite-transform");
  });

  it("tells you to add a missing npm package to package.json", () => {
    const [d] = parseBuildError(fixtures.missingPackage, ROOT);
    expect(d.file).toBe("src/pages/Index.tsx");
    expect(d.message).toContain('"left-pad-zzz" isn\'t installed');
    expect(d.message).not.toContain(ROOT);
  });

  it("explains a missing named export", () => {
    const [d] = parseBuildError(fixtures.missingExport, ROOT);
    expect(d).toMatchObject({ file: "src/pages/Index.tsx", line: 1, column: 10 });
    expect(d.message).toContain('"Nope" is not exported');
    expect(d.message).toContain("default vs named export");
  });
});

describe("parseTscOutput", () => {
  it("parses tsc diagnostics including continuation lines", () => {
    const out = [
      "/work/app/src/App.tsx(12,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      "src/lib/x.ts(3,1): error TS2304: Cannot find name 'foo'.",
      "  Did you mean 'for'?",
      "Found 2 errors.",
    ].join("\n");
    const diags = parseTscOutput(out, ROOT);
    expect(diags).toHaveLength(2);
    expect(diags[0]).toMatchObject({ kind: "type", file: "src/App.tsx", line: 12, column: 5 });
    expect(diags[1].message).toContain("Did you mean 'for'?");
    expect(diags[1].message).toContain("TS2304");
  });
});

describe("parseNpmError", () => {
  it("explains a package that doesn't exist", () => {
    const [d] = parseNpmError("npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/left-pad-zzz - Not found\nnpm error 404  'left-pad-zzz@^1.0.0' is not in this registry.");
    expect(d.message).toContain('"left-pad-zzz" doesn\'t exist on npm');
  });

  it("explains a version that doesn't exist", () => {
    const [d] = parseNpmError("npm error code ETARGET\nnpm error notarget No matching version found for react@^99.0.0.");
    expect(d.message).toContain('No version of "react" matches "^99.0.0"');
  });
});
