import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Best-effort guard so a plan limit never goes back to being a bare error: any API route that
// answers 402/403 with plan wording must go through the plan-gate helpers (a PLAN_* code and the
// plan that lifts it), and no dashboard screen may hold the old bare limit sentences.
const ROOT = join(__dirname, "..");
const walk = (dir: string, test: (f: string) => boolean): string[] =>
  readdirSync(dir).flatMap((n) => {
    if (["node_modules", ".next"].includes(n)) return [];
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p, test) : test(p) ? [p] : [];
  });

const PLAN_WORDS = /upgrade|your plan|plan allows|plan holds|Starter plan|Pro plan|part of the (Starter|Pro|Enterprise)/i;
const USES_GATE = /planGateBody|planGateResponse|limitGateResponse|planLimitResponse|parsePlanGate|code: "PLAN_|PLAN_[A-Z_]+/;
// Routes whose plan wording is not a gate: billing screens and webhooks explain plans, they don't limit anything.
const NOT_GATES = [/^app\/api\/billing\//, /^app\/api\/webhooks\//, /^app\/api\/internal\//, /^app\/api\/v1\/plan\//, /^app\/api\/org\/invite\/\[id\]\/accept\//];

describe("plan limits answer with a code and the plan that lifts them", () => {
  it("no API route answers 402/403 with plan wording and no PLAN_* code", () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, "app/api"), (f) => f.endsWith(".ts"))) {
      const rel = relative(ROOT, file);
      if (NOT_GATES.some((r) => r.test(rel))) continue;
      const src = readFileSync(file, "utf8");
      if (USES_GATE.test(src)) continue;
      const lines = src.split("\n");
      lines.forEach((line, i) => {
        if (!/status: (402|403)/.test(line)) return;
        const near = lines.slice(Math.max(0, i - 4), i + 1).join(" ");
        if (PLAN_WORDS.test(near)) offenders.push(`${rel}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("no dashboard screen shows a bare plan-limit sentence", () => {
    const BARE = /Your plan allows a maximum|Upgrade plan to create more|Template limit reached|Published domain limit reached|used every funnel slot your plan includes\. Buy/;
    const offenders = walk(join(ROOT, "app"), (f) => /\.(ts|tsx)$/.test(f) && !f.includes("/api/")).filter((f) => BARE.test(readFileSync(f, "utf8"))).map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it("no server code throws the old bare limit sentences", () => {
    const BARE = /Your plan allows a maximum|Upgrade plan to create more|Template limit reached|Published domain limit reached/;
    const offenders = walk(join(ROOT, "lib"), (f) => f.endsWith(".ts")).filter((f) => BARE.test(readFileSync(f, "utf8"))).map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it("UI error spots on the commerce, funnel and course screens go through the upgrade prompt", () => {
    const dirs = ["app/dashboard/commerce", "app/dashboard/funnels", "app/dashboard/_v3/learners", "app/dashboard/_v3/hub"];
    const missing = dirs.flatMap((d) => walk(join(ROOT, d), (f) => f.endsWith(".tsx"))).filter((f) => {
      const src = readFileSync(f, "utf8");
      return /\{(error|loadError)\}/.test(src) && !/GateOrError|UpgradePrompt|SettingsActionBar/.test(src);
    }).map((f) => relative(ROOT, f));
    // Read-only list/detail screens that cannot hit a plan limit are exempt.
    expect(missing.filter((f) => !/(Customers|Wallet|Loading|BrandTab|HealthTab|Visits|EditWebsiteButton|VersionsSection)/.test(f))).toEqual([]);
  });
});
