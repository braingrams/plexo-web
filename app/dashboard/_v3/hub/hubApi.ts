import { rememberPlanGate } from "@/lib/plan/planGate";
/** fetch + JSON, with the server's plain-words message (or a friendly fallback) when it fails. */
export async function hubApi<T = Record<string, unknown>>(url: string, init?: RequestInit & { json?: unknown }, fallback = "That didn't work. Please try again."): Promise<T> {
  const { json, ...rest } = init ?? {};
  let res: Response;
  try {
    res = await fetch(url, { ...rest, headers: json !== undefined ? { "Content-Type": "application/json", ...(rest.headers ?? {}) } : rest.headers, body: json !== undefined ? JSON.stringify(json) : rest.body });
  } catch {
    throw new Error("We couldn't reach Plexo. Check your internet and try again.");
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) rememberPlanGate(data);
  if (!res.ok) throw Object.assign(new Error(typeof data.error === "string" && data.error ? data.error : fallback), { data, status: res.status });
  return data;
}

export const errMsg = (e: unknown, fallback = "That didn't work. Please try again.") => (e instanceof Error && e.message ? e.message : fallback);
