import { describe, expect, it } from "vitest";
import { transformSync } from "esbuild";
import { OPEN_NEXT_PACKAGE, missingAdapterMessage, planSsrBuild } from "../src/ssrPlan";
import { astroFunctionShim, remixShim } from "../src/ssrShims";

describe("planSsrBuild", () => {
  it("runs OpenNext for Next.js, which builds the app itself, and reads its function folder", () => {
    const plan = planSsrBuild("nextjs");
    expect(plan.buildSteps).toEqual([["exec", "--", "open-next", "build"]]);
    expect(plan.extraInstalls[0]).toContain(OPEN_NEXT_PACKAGE);
    expect(plan.server).toEqual({ kind: "folder", dir: ".open-next/server-functions/default", entry: "index.mjs" });
    expect(plan.clientDir).toBe(".open-next/assets");
    expect(plan.image).toEqual({ dir: ".open-next/image-optimization-function" });
  });

  it("sets NITRO_PRESET=aws-lambda for Nitro-family frameworks", () => {
    for (const framework of ["nuxt", "nitro"] as const) {
      const plan = planSsrBuild(framework);
      expect(plan.env).toEqual({ NITRO_PRESET: "aws-lambda" });
      expect(plan.server).toEqual({ kind: "folder", dir: ".output/server", entry: "index.mjs" });
      expect(plan.clientDir).toBe(".output/public");
    }
  });

  it("bundles Remix with a shim and ships Astro unbundled, trying each known server entry", () => {
    expect(planSsrBuild("remix").server).toEqual({ kind: "bundle", entryCandidates: ["build/server/index.js", "build/index.js"], shim: "remix" });
    expect(planSsrBuild("astro").server).toEqual({ kind: "shimmed", serverDir: "dist/server", entryCandidates: ["dist/server/entry.mjs"], shim: "astro" });
  });

  it("never runs a build step through a shell: every step is an argument list", () => {
    for (const framework of ["nextjs", "nuxt", "nitro", "remix", "astro"] as const) {
      for (const step of planSsrBuild(framework).buildSteps) {
        expect(step.every((arg) => typeof arg === "string")).toBe(true);
      }
    }
  });
});

describe("missingAdapterMessage", () => {
  it("asks for the Astro Node adapter when it's absent", () => {
    expect(missingAdapterMessage("astro", { astro: "5" })).toMatch(/@astrojs\/node/);
    expect(missingAdapterMessage("astro", { astro: "5", "@astrojs/node": "9" })).toBeNull();
  });
  it("asks for @remix-run/node when Remix is detected without it", () => {
    expect(missingAdapterMessage("remix", { "@remix-run/react": "2" })).toMatch(/@remix-run\/node/);
    expect(missingAdapterMessage("remix", { "@remix-run/node": "2" })).toBeNull();
    expect(missingAdapterMessage("remix", { "@react-router/node": "8" })).toBeNull();
  });
  it("needs nothing for Next.js or Nitro", () => {
    expect(missingAdapterMessage("nextjs", {})).toBeNull();
    expect(missingAdapterMessage("nitro", {})).toBeNull();
  });
});

describe("generated shims", () => {
  // Each shim must be valid ESM: esbuild's parser is the same one the bundler uses.
  const parses = (source: string) => {
    expect(() => transformSync(source, { loader: "js", format: "esm" })).not.toThrow();
  };

  it("React Router shim takes its request handler from react-router", () => {
    const source = remixShim("./../build/server/index.js", "react-router");
    expect(source).toContain('from "react-router"');
    expect(source).not.toContain("@remix-run/node");
  });

  it("Remix shim imports the server build and @remix-run/node, and exports handler", () => {
    const source = remixShim("./../build/server/index.js");
    parses(source);
    expect(source).toContain('import * as build from "./../build/server/index.js"');
    expect(source).toContain('from "@remix-run/node"');
    expect(source).toContain("export const handler");
  });

  it("Astro function shim loads the entry by runtime URL, so it isn't bundled", () => {
    const source = astroFunctionShim("./dist/server/entry.mjs");
    parses(source);
    expect(source).toContain('process.env.HOST = "127.0.0.1"');
    expect(source).toContain('new URL("./dist/server/entry.mjs", import.meta.url)');
    expect(source).toContain("export const handler");
  });

  it("the shared adapter converts Function URL events both ways", () => {
    const source = remixShim("./x.js");
    expect(source).toContain("isBase64Encoded: true");
    expect(source).toContain("getSetCookie");
  });
});
