import { createHash } from "node:crypto";
import semver from "semver";

// Decides how a build gets its node_modules, without running anything:
// - "base":   every dependency is already in the image's pre-installed set (/opt/base) at a
//             version that satisfies the project's range → symlink it. No install at all —
//             the case for nearly every build, since projects start from the scaffold.
// - "cached": the project has extra dependencies, and a node_modules tarball for exactly
//             this dependency set was saved by an earlier build → download and unpack.
// - "install": anything else → npm install (scripts disabled), then cache the result.

export type InstallPlan =
  | { mode: "base" }
  | { mode: "cached" | "install"; depsHash: string; dependencies: Record<string, string>; devDependencies: Record<string, string> };

export type BaseVersions = Record<string, string>; // package name → installed version

export function planInstall(packageJsonText: string | null, base: BaseVersions): InstallPlan {
  if (!packageJsonText) return { mode: "base" };
  let pkg: any;
  try {
    pkg = JSON.parse(packageJsonText);
  } catch {
    throw new InstallPlanError("package.json isn't valid JSON — fix the syntax (a missing comma or quote is the usual cause).");
  }
  const dependencies = sanitizeDeps(pkg.dependencies, "dependencies");
  const devDependencies = sanitizeDeps(pkg.devDependencies, "devDependencies");
  const all = { ...devDependencies, ...dependencies };
  rejectTooHeavy(Object.keys(all));
  const allInBase = Object.entries(all).every(([name, range]) => satisfiedByBase(name, range, base));
  if (allInBase) return { mode: "base" };
  const depsHash = createHash("sha256")
    .update(JSON.stringify([sortObject(dependencies), sortObject(devDependencies)]))
    .digest("hex")
    .slice(0, 32);
  return { mode: "install", depsHash, dependencies, devDependencies };
}

export class InstallPlanError extends Error {}

// Packages that are far too big for an app build (installing and type-checking them runs the
// build past its time limit — e.g. Stripe's SDK on staging) or need native binaries that
// can't run here. Each has a light way to do the same job; the build stops at once and says
// which, instead of failing minutes later.
const TOO_HEAVY: Array<{ match: (name: string) => boolean; instead: string }> = [
  { match: (n) => n === "stripe", instead: "Call Stripe's API with fetch from a server function (functions/), using env.STRIPE_SECRET_KEY — see \"Payments\" in PLEXO.md." },
  { match: (n) => n === "aws-sdk" || n.startsWith("@aws-sdk/"), instead: "Call the AWS service's HTTP API with fetch from a server function, or use Plexo's built-in storage (plexo.storage)." },
  { match: (n) => n === "firebase-admin" || n === "googleapis" || n.startsWith("@google-cloud/"), instead: "Call the Google API's REST endpoint with fetch from a server function, using a key from env." },
  { match: (n) => n === "puppeteer" || n === "playwright" || n === "playwright-core" || n === "selenium-webdriver", instead: "Browsers can't run inside an app. Plexo checks your preview for you." },
  { match: (n) => n === "sharp" || n === "canvas" || n === "bcrypt" || n === "sqlite3" || n === "better-sqlite3", instead: "This needs native code that can't run here. Use Plexo's database and storage, or a pure-JavaScript alternative (e.g. bcryptjs)." },
  { match: (n) => n === "prisma" || n === "@prisma/client" || n === "typeorm" || n === "sequelize" || n === "mongoose", instead: "Use the plexo client (plexo.from(...)) for the database — it's already set up." },
];

function rejectTooHeavy(names: string[]): void {
  for (const name of names) {
    const hit = TOO_HEAVY.find((h) => h.match(name));
    if (hit) throw new InstallPlanError(`"${name}" is too big to build into an app (it makes the build run out of time), so it isn't supported. ${hit.instead} Remove it from package.json.`);
  }
}

const NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

function sanitizeDeps(raw: unknown, field: string): Record<string, string> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) throw new InstallPlanError(`package.json "${field}" must be an object of { "package-name": "version" }.`);
  const out: Record<string, string> = {};
  for (const [name, range] of Object.entries(raw as Record<string, unknown>)) {
    if (!NAME.test(name)) throw new InstallPlanError(`"${name}" in package.json ${field} isn't a valid npm package name.`);
    if (typeof range !== "string") throw new InstallPlanError(`The version for "${name}" in package.json must be text, like "^1.2.0".`);
    // Only registry versions. git/file/link/http specs could fetch or link arbitrary code
    // outside npm's integrity checks.
    if (/^(git|git\+|github:|file:|link:|https?:|workspace:)/i.test(range.trim()) || range.includes("/")) {
      throw new InstallPlanError(`"${name}": "${range}" — only versions from the npm registry are supported (like "^1.2.0" or "latest").`);
    }
    out[name] = range.trim() || "latest";
  }
  return out;
}

function satisfiedByBase(name: string, range: string, base: BaseVersions): boolean {
  const installed = base[name];
  if (!installed) return false;
  if (range === "latest" || range === "*" || range === "") return true;
  try {
    return semver.satisfies(installed, range, { includePrerelease: true });
  } catch {
    return false;
  }
}

function sortObject(o: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
}
