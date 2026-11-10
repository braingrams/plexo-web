import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { isEnvFilePath } from "@/lib/projects/envFileNames";
import { removeEnvFilesFromZip } from "@/lib/projects/envFiles";
import { inspectSsrSource } from "@/lib/projects/ssrSource";

describe("isEnvFilePath", () => {
  it.each([".env", ".env.local", ".env.production", ".envrc", "prod.env", "app/.env", "config/staging.local.env", ".ENV"])("drops %s", (path) => {
    expect(isEnvFilePath(path)).toBe(true);
  });

  it.each(["package.json", "src/environment.ts", "src/env.ts", "app/envelope.tsx", "public/env-logo.svg"])("keeps %s", (path) => {
    expect(isEnvFilePath(path)).toBe(false);
  });
});

async function zipOf(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, body] of Object.entries(files)) zip.file(name, body);
  return zip.generateAsync({ type: "uint8array" });
}

describe("removeEnvFilesFromZip", () => {
  it("removes env files and keeps everything else", async () => {
    const original = await zipOf({ "package.json": "{}", ".env": "API_KEY=secret", "src/index.ts": "x", "app/.env.local": "y" });
    const { bytes, dropped } = await removeEnvFilesFromZip(original);
    expect(dropped.sort()).toEqual([".env", "app/.env.local"]);
    const names = Object.values((await JSZip.loadAsync(bytes)).files).filter((f) => !f.dir).map((f) => f.name).sort();
    expect(names).toEqual(["package.json", "src/index.ts"]);
  });

  it("returns the original bytes when there is nothing to drop", async () => {
    const original = await zipOf({ "package.json": "{}" });
    const { bytes, dropped } = await removeEnvFilesFromZip(original);
    expect(dropped).toEqual([]);
    expect(bytes).toBe(original);
  });
});

describe("inspectSsrSource", () => {
  it("drops env files from the stored source and says so", async () => {
    const upload = await zipOf({
      "package.json": JSON.stringify({ dependencies: { next: "16.0.0" } }),
      ".env.production": "NEXT_PUBLIC_KEY=abc",
      "app/page.tsx": "export default null",
    });
    const result = await inspectSsrSource(upload);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stored = Object.keys((await JSZip.loadAsync(result.source)).files);
    expect(stored).not.toContain(".env.production");
    expect(stored).toContain("app/page.tsx");
    expect(result.warnings.join(" ")).toMatch(/environment file/);
    expect(result.warnings.join(" ")).toMatch(/Variables and Secrets/);
  });
});
