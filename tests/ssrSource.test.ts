import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { inspectSsrSource, detectSsrFramework, findUnsafeEntry } from "@/lib/projects/ssrSource";

async function zipOf(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, body] of Object.entries(files)) zip.file(name, body);
  return zip.generateAsync({ type: "uint8array" });
}

const pkg = (deps: Record<string, string>, devDeps: Record<string, string> = {}) =>
  JSON.stringify({ name: "app", dependencies: deps, devDependencies: devDeps });

describe("detectSsrFramework", () => {
  it("accepts Next.js now that its image optimizer is deployed", () => {
    expect(detectSsrFramework({ dependencies: { next: "15.0.0", react: "19" } })).toEqual({ framework: "nextjs" });
  });
  it("detects Nuxt and Nitro, treating Nuxt as the Nitro family without double-counting", () => {
    expect(detectSsrFramework({ dependencies: { nuxt: "3.0.0", nitropack: "2.0.0" } })).toEqual({ framework: "nuxt" });
    expect(detectSsrFramework({ devDependencies: { nitropack: "2.0.0" } })).toEqual({ framework: "nitro" });
  });
  it("detects Remix from any @remix-run package and Astro from astro", () => {
    expect(detectSsrFramework({ dependencies: { "@remix-run/node": "2.0.0" } })).toEqual({ framework: "remix" });
    expect(detectSsrFramework({ devDependencies: { astro: "5.0.0" } })).toEqual({ framework: "astro" });
  });
  it("rejects two frameworks at once", () => {
    expect("error" in detectSsrFramework({ dependencies: { next: "15", astro: "5" } })).toBe(true);
  });
  it("names unsupported frameworks instead of saying none were found", () => {
    const result = detectSsrFramework({ dependencies: { "@sveltejs/kit": "2" } });
    expect("error" in result && result.error).toMatch(/SvelteKit isn't supported/);
  });
  it("rejects a project with no framework", () => {
    expect("error" in detectSsrFramework({ dependencies: { react: "19" } })).toBe(true);
  });
});

describe("inspectSsrSource", () => {
  it("accepts a zip whose root holds package.json", async () => {
    const zip = await zipOf({ "package.json": pkg({ astro: "5" }), "app/page.tsx": "export default null;" });
    const result = await inspectSsrSource(zip);
    expect(result).toMatchObject({ ok: true, framework: "astro", root: "" });
  });

  it("accepts a single wrapper folder around the project", async () => {
    const zip = await zipOf({ "my-site/package.json": pkg({ astro: "5" }), "my-site/src/pages/index.astro": "<h1>hi</h1>" });
    const result = await inspectSsrSource(zip);
    expect(result).toMatchObject({ ok: true, framework: "astro", root: "my-site/" });
  });

  it("rejects a zip with no package.json at the root", async () => {
    const zip = await zipOf({ "a/package.json": pkg({ astro: "5" }), "b/index.js": "x" });
    expect(await inspectSsrSource(zip)).toMatchObject({ ok: false });
  });

  it("rejects path traversal, absolute, and backslash entry names", () => {
    expect(findUnsafeEntry(["package.json", "../escape.txt"])).toBe("../escape.txt");
    expect(findUnsafeEntry(["/etc/passwd"])).toBe("/etc/passwd");
    expect(findUnsafeEntry(["src\\x.ts"])).toBe("src\\x.ts");
    expect(findUnsafeEntry(["package.json", "src/a.ts"])).toBeNull();
  });

  it("rejects invalid JSON in package.json", async () => {
    const zip = await zipOf({ "package.json": "{not json" });
    expect(await inspectSsrSource(zip)).toMatchObject({ ok: false, error: "package.json isn't valid JSON." });
  });

  it("rejects bytes that aren't a zip", async () => {
    expect(await inspectSsrSource(new TextEncoder().encode("hello"))).toMatchObject({ ok: false });
  });
});

describe("node_modules and size limits", () => {
  it("warns that node_modules in the upload will be dropped", async () => {
    const zip = await zipOf({ "package.json": pkg({ astro: "5" }), "node_modules/left-pad/index.js": "x" });
    const result = await inspectSsrSource(zip);
    expect(result).toMatchObject({ ok: true });
    expect("warnings" in result && result.warnings).toEqual([expect.stringMatching(/node_modules.*dropped/)]);
  });
  it("has no warnings for a clean upload", async () => {
    const zip = await zipOf({ "package.json": pkg({ astro: "5" }) });
    expect(await inspectSsrSource(zip)).toMatchObject({ ok: true, warnings: [] });
  });
  it("allows 100MB of source", async () => {
    const { SSR_MAX_ZIP_BYTES } = await import("@/lib/projects/ssrSource");
    expect(SSR_MAX_ZIP_BYTES).toBe(100 * 1024 * 1024);
  });
});
