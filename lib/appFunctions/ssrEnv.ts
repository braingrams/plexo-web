// Validation for an SSR app's environment variables. Pure, so it's tested without AWS.
// Values are write-only: the API reports names, never values.

/** Lambda's limit on the total size of a function's environment (keys and values together). */
export const SSR_ENV_MAX_BYTES = 4 * 1024;

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

export type SsrEnvChange = { set: Record<string, string>; unset: string[] };

/** Returns the first problem with a change, or null. `current` is the names+values already set. */
export function validateSsrEnvChange(change: SsrEnvChange, current: Record<string, string>): string | null {
  for (const key of [...Object.keys(change.set), ...change.unset]) {
    if (!KEY_PATTERN.test(key)) return `"${key}" isn't a valid variable name (letters, digits, and underscores; not starting with a digit).`;
    if (key.startsWith("AWS_")) return `"${key}" is reserved: variables starting with AWS_ are set by the platform.`;
  }
  for (const [key, value] of Object.entries(change.set)) {
    if (typeof value !== "string") return `The value for "${key}" must be a string.`;
  }
  const merged: Record<string, string> = { ...current };
  for (const key of change.unset) delete merged[key];
  Object.assign(merged, change.set);
  const bytes = Object.entries(merged).reduce((total, [k, v]) => total + Buffer.byteLength(k) + Buffer.byteLength(v), 0);
  if (bytes > SSR_ENV_MAX_BYTES) return `The variables would total ${bytes} bytes; the limit is ${SSR_ENV_MAX_BYTES}.`;
  return null;
}

/** Parses a request body into a change, or returns an error string. */
export function parseSsrEnvBody(body: unknown): SsrEnvChange | string {
  if (!body || typeof body !== "object") return "Send a JSON object with `set` and/or `unset`.";
  const { set = {}, unset = [] } = body as { set?: unknown; unset?: unknown };
  if (typeof set !== "object" || set === null || Array.isArray(set)) return "`set` must be an object of name to value.";
  if (!Array.isArray(unset) || unset.some((k) => typeof k !== "string")) return "`unset` must be a list of variable names.";
  return { set: set as Record<string, string>, unset: unset as string[] };
}
