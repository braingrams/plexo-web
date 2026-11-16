import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" || e.name === ".next" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(e.name) ? [full] : [];
  });
}

describe("/brand/* files", () => {
  it("are routed to the assets bucket by CloudFront (the server function doesn't carry public/)", () => {
    const stack = fs.readFileSync(path.join(root, "cdk/lib/compute-stack.ts"), "utf8");
    expect(stack).toMatch(/"brand\/\*":\s*\{/);
  });

  it("every /brand/ file referenced in app/ or lib/ exists in public/brand/", () => {
    const refs = new Set<string>();
    for (const file of [...sourceFiles(path.join(root, "app")), ...sourceFiles(path.join(root, "lib"))]) {
      for (const m of fs.readFileSync(file, "utf8").matchAll(/(?:["`']|\})\/brand\/([A-Za-z0-9_.-]+\.[a-z0-9]+)/g)) refs.add(m[1]);
    }
    expect(refs.size).toBeGreaterThan(0);
    const missing = [...refs].filter((name) => !fs.existsSync(path.join(root, "public/brand", name)));
    expect(missing).toEqual([]);
  });
});
