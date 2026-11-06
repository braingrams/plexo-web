import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withoutStaticExport, withAssetPrefix, prepareNextConfig, APP_ASSET_PREFIX } from "../src/nextConfig";

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

describe("withAssetPrefix", () => {
  it("sets the prefix in a typed config object", () => {
    const result = withAssetPrefix("const nextConfig: NextConfig = {\n  images: {},\n}", "/__plexo/assets");
    expect(result.changed).toBe(true);
    expect(result.source).toContain('assetPrefix: "/__plexo/assets"');
    expect(result.source).toContain("images: {}");
  });
  it("sets the prefix in an export default object", () => {
    expect(withAssetPrefix("export default {\n  reactStrictMode: true,\n}", "/p").source).toContain('assetPrefix: "/p"');
  });
  it("leaves a config alone when it already sets an asset prefix", () => {
    expect(withAssetPrefix("const c = {\n  assetPrefix: '/x',\n}", "/p")).toEqual({ source: "const c = {\n  assetPrefix: '/x',\n}", changed: false });
  });
  it("reports nothing to change when no config object can be found", () => {
    expect(withAssetPrefix("module.exports = require('./x')", "/p").changed).toBe(false);
  });
});

describe("prepareNextConfig", () => {
  it("removes the static export and sets the asset prefix in one pass", () => {
    const dir = mkdtempSync(join(tmpdir(), "nextcfg-"));
    writeFileSync(join(dir, "next.config.ts"), "const nextConfig: NextConfig = {\n  output: 'export',\n}\n");
    const changes = prepareNextConfig(dir);
    expect(changes).toEqual(["next.config.ts: removed the static HTML export setting", `next.config.ts: serves built assets under ${APP_ASSET_PREFIX}`]);
    const after = readFileSync(join(dir, "next.config.ts"), "utf8");
    expect(after).not.toMatch(/output\s*:\s*['"]export/);
    expect(after).toContain(`assetPrefix: "${APP_ASSET_PREFIX}"`);
  });
  it("does nothing when the app needs no change", () => {
    const dir = mkdtempSync(join(tmpdir(), "nextcfg-"));
    writeFileSync(join(dir, "next.config.mjs"), "const c = {\n  assetPrefix: '/x',\n}\n");
    expect(prepareNextConfig(dir)).toEqual([]);
    expect(prepareNextConfig(mkdtempSync(join(tmpdir(), "nextcfg-empty-")))).toEqual([]);
  });
});
