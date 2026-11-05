import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withoutStaticExport, disableStaticExportInConfig } from "../src/nextConfig";

describe("withoutStaticExport", () => {
  it("removes output: 'export' and keeps the other settings", () => {
    const src = "const nextConfig: NextConfig = {\n  output: 'export',\n  images: { unoptimized: true },\n}\n";
    const result = withoutStaticExport(src);
    expect(result.changed).toBe(true);
    expect(result.source).not.toMatch(/output\s*:\s*['"]export/);
    expect(result.source).toContain("images: { unoptimized: true }");
  });

  it("handles double quotes, no trailing comma, and an inline object", () => {
    expect(withoutStaticExport('{ output: "export" }').source).not.toMatch(/output/);
    expect(withoutStaticExport("{ output: 'export' }").changed).toBe(true);
  });

  it("leaves other output modes and configs without it alone", () => {
    expect(withoutStaticExport("{ output: 'standalone' }")).toEqual({ source: "{ output: 'standalone' }", changed: false });
    expect(withoutStaticExport("{ images: {} }").changed).toBe(false);
  });
});

describe("disableStaticExportInConfig", () => {
  it("rewrites the config in the build folder and reports the file", () => {
    const dir = mkdtempSync(join(tmpdir(), "nextcfg-"));
    writeFileSync(join(dir, "next.config.ts"), "export default { output: 'export' }\n");
    expect(disableStaticExportInConfig(dir)).toBe("next.config.ts");
    expect(readFileSync(join(dir, "next.config.ts"), "utf8")).not.toMatch(/output: 'export'/);
  });

  it("does nothing when the app has no static export", () => {
    const dir = mkdtempSync(join(tmpdir(), "nextcfg-"));
    writeFileSync(join(dir, "next.config.mjs"), "export default {}\n");
    expect(disableStaticExportInConfig(dir)).toBeNull();
    expect(disableStaticExportInConfig(mkdtempSync(join(tmpdir(), "nextcfg-empty-")))).toBeNull();
  });
});
