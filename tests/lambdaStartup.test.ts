import { describe, expect, it } from "vitest";
import { build } from "esbuild";
import path from "node:path";

// The build finaliser (publish: live database, server functions, going live) doesn't ship
// playwright-core. When a new import chain made it load the browser library at start-up,
// every publish hung at "Building a clean copy" ("Cannot find module 'playwright-core'").
// Bundled exactly as cdk/lib/project-runtime.ts does, it must never require it eagerly.

describe("the build finaliser starts without the browser library", () => {
  it("never requires playwright-core when it loads", async () => {
    const root = path.resolve(__dirname, "..");
    const out = await build({
      entryPoints: [path.join(root, "lambda/build-finalize/index.ts")],
      bundle: true,
      platform: "node",
      target: "node22",
      format: "cjs",
      tsconfig: path.join(root, "tsconfig.json"),
      external: ["pg-native", "playwright-core"],
      write: false,
      logLevel: "silent",
    });
    expect(out.outputFiles[0].text).not.toMatch(/require\(["']playwright-core["']\)/);
  }, 120_000);
});
