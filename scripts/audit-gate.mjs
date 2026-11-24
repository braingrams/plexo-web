#!/usr/bin/env node
/**
 * Fails the build when a production dependency has a HIGH or CRITICAL known vulnerability that nobody has looked at.
 *
 * `npm audit` alone cannot be a required check here: some advisories have no fix yet or need a breaking upgrade that is planned
 * separately. Those are written down in .audit-allowlist.json with a reason and an expiry date. Anything not on the list fails the
 * check, and an entry past its expiry fails it too, so an accepted risk cannot be forgotten.
 *
 * Usage: node scripts/audit-gate.mjs   (run after `npm ci`)
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const LEVELS = new Set(["high", "critical"]);
const today = new Date().toISOString().slice(0, 10);

let report;
try {
  report = JSON.parse(execFileSync("npm", ["audit", "--omit=dev", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }));
} catch (err) {
  // npm audit exits non-zero when it finds anything; the JSON is still on stdout.
  try {
    report = JSON.parse(err.stdout);
  } catch {
    console.error("Could not read the npm audit report. Is the registry reachable?");
    process.exit(2);
  }
}

const allow = existsSync(".audit-allowlist.json") ? JSON.parse(readFileSync(".audit-allowlist.json", "utf8")) : {};
const problems = [];
const accepted = [];

for (const [name, v] of Object.entries(report.vulnerabilities ?? {})) {
  if (!LEVELS.has(v.severity)) continue;
  const entry = allow[name];
  if (!entry) problems.push(`${v.severity.toUpperCase()}  ${name}  (${v.range})  not on the allowlist. ${v.fixAvailable ? "A fix is available: run npm audit fix." : "No fix yet: add it to .audit-allowlist.json with a reason and an expiry."}`);
  else if (entry.expires < today) problems.push(`${v.severity.toUpperCase()}  ${name}  allowlist entry expired on ${entry.expires} (${entry.reason})`);
  else accepted.push(`${name}  until ${entry.expires}: ${entry.reason}`);
}

if (accepted.length) console.log(`Accepted for now (${accepted.length}):\n  ${accepted.join("\n  ")}\n`);
if (problems.length) {
  console.error(`Dependency check failed (${problems.length}):\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("Dependency check passed: no unreviewed high or critical vulnerabilities in production dependencies.");
