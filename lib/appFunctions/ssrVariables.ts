// Rules for an SSR app's variables and secrets, split by where they go. Pure: no database, no AWS,
// so the rules are tested on their own.
//
//   - A VARIABLE is a visible setting. It's stored in the database, shown in the dashboard, and set
//     on the server function's environment. If it's marked buildTime, or its name has a public
//     prefix (NEXT_PUBLIC_…), it's also passed to the build, because the build bakes it in.
//   - A SECRET is stored encrypted (lib/appFunctions/secrets.ts). It never reaches the build or the
//     function's configuration. The function fetches it at cold start.
//
// Anything with a public prefix ends up in browser JavaScript, so it can never be a secret.

import { createHash } from "node:crypto";

export type VariableScope = "all" | "dev" | "live";
export type VariableEnv = "dev" | "live";

/** Names that a browser bundle may read. These are always public, so they're variables, not secrets. */
export const PUBLIC_PREFIXES = ["NEXT_PUBLIC_", "NUXT_PUBLIC_", "VITE_", "PUBLIC_", "REACT_APP_"] as const;

/** Lambda's limit on a function's whole environment. Runtime variables share it with Plexo's own keys. */
export const RUNTIME_VARIABLE_BYTES = 3 * 1024;

const NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const RESERVED = /^(AWS_|LAMBDA_|PLEXO_|NODE_|_HANDLER$|_X_AMZN|TZ$|PATH$|LANG$|HOME$)/;
const MAX_VALUE_BYTES = 4 * 1024;
export const MAX_VARIABLES = 100;

export function isPublicName(name: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export function variableNameProblem(name: string): string | null {
  if (!NAME_RE.test(name)) return "Use capital letters, numbers and underscores, starting with a letter (like API_BASE_URL).";
  if (RESERVED.test(name)) return `${name} is reserved by Plexo. Pick another name.`;
  return null;
}

export function variableValueProblem(value: string): string | null {
  if (Buffer.byteLength(value) > MAX_VALUE_BYTES) return "That value is too long (4 KB at most).";
  return null;
}

export function isValidScope(scope: unknown): scope is VariableScope {
  return scope === "all" || scope === "dev" || scope === "live";
}

/** Whether a variable applies to an environment. "all" applies to both. */
export function appliesTo(scope: VariableScope, env: VariableEnv): boolean {
  return scope === "all" || scope === env;
}

export type StoredVariable = { name: string; scope: VariableScope; value: string; buildTime: boolean };

/** The values passed to the build for an environment: build-time ones, and public-prefixed ones. */
export function buildVariablesFor(vars: StoredVariable[], env: VariableEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of vars) {
    if (appliesTo(v.scope, env) && (v.buildTime || isPublicName(v.name))) out[v.name] = v.value;
  }
  return out;
}

/** The values set on the function's environment for an environment: every variable that applies. */
export function runtimeVariablesFor(vars: StoredVariable[], env: VariableEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of vars) if (appliesTo(v.scope, env)) out[v.name] = v.value;
  return out;
}

/** Bytes a set of runtime variables takes in the function's environment (names and values). */
export function runtimeBytes(values: Record<string, string>): number {
  return Object.entries(values).reduce((total, [k, v]) => total + Buffer.byteLength(k) + Buffer.byteLength(v), 0);
}

/** A stable fingerprint of a set of build variables, to tell whether two builds used the same values. */
export function buildVarsHash(values: Record<string, string>): string {
  const sorted = Object.keys(values).sort().map((k) => [k, values[k]]);
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

/** Secrets set for preview but missing a live value. Publishing warns about these. */
export function previewOnlySecrets(secrets: Array<{ name: string; scope: string }>): string[] {
  const liveNames = new Set(secrets.filter((s) => s.scope === "all" || s.scope === "live").map((s) => s.name));
  return [...new Set(secrets.filter((s) => s.scope === "dev" && !liveNames.has(s.name)).map((s) => s.name))].sort();
}
