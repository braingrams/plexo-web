// Models sometimes send a list or object argument as JSON *text* — `"files": "[{\"path\":…}]"`
// instead of `"files": [{"path":…}]`. On staging SOL lost five paid rounds to "No edits were
// given" / "No files were given to save" this way. Every tool declares its arguments' types,
// so a value declared as an array or object that arrives as a string holding exactly that is
// unwrapped before the tool runs. Anything else is left for the tool to judge.

type Schema = { properties?: Record<string, { type?: string | string[] }> };

export function coerceToolArgs(args: unknown, schema: Schema | undefined): unknown {
  if (!schema?.properties || !args || typeof args !== "object" || Array.isArray(args)) return args;
  const out: Record<string, unknown> = { ...(args as Record<string, unknown>) };
  for (const [key, prop] of Object.entries(schema.properties)) {
    const want = prop?.type;
    const value = out[key];
    if ((want !== "array" && want !== "object") || typeof value !== "string") continue;
    const text = value.trim();
    if (!(want === "array" ? text.startsWith("[") : text.startsWith("{"))) continue;
    try {
      const parsed = JSON.parse(text);
      if (want === "array" ? Array.isArray(parsed) : parsed && typeof parsed === "object" && !Array.isArray(parsed)) out[key] = parsed;
    } catch {
      // Not valid JSON: leave it, and the tool's own message says what's wrong.
    }
  }
  return out;
}
