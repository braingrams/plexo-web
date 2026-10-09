// Bundled into every server function (functions/<name>.ts). Adapts Plexo's invocation event
// to the standard Request → Response shape the owner's code is written against, and builds
// its `ctx`. A function's Lambda has NO AWS permissions; everything it does with the app's
// data goes through the app's own /__plexo/api gateway with the app's service key, exactly
// like the browser client but allowed past row-level security.

type InvokeEvent =
  | {
      kind: "http";
      method: string;
      url: string;
      headers: Record<string, string>;
      bodyBase64?: string;
      user: { id: string; email: string; role: string; metadata: Record<string, unknown> } | null;
    }
  | { kind: "schedule"; scheduledAt: string };

type InvokeResult = { status: number; headers: Record<string, string>; bodyBase64: string };

const API = (process.env.PLEXO_API_URL ?? "").replace(/\/+$/, "");
const KEY = process.env.PLEXO_SERVICE_KEY ?? "";

async function call(path: string, init: RequestInit = {}): Promise<{ data: any; error: { message: string } | null; count?: number | null }> {
  try {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: { "content-type": "application/json", "x-plexo-service-key": KEY, ...(init.headers ?? {}) },
    });
    const json: any = await res.json().catch(() => null);
    if (!res.ok) return { data: null, error: { message: json?.error?.message ?? `Request failed (${res.status})` } };
    return { data: json?.data ?? null, error: null, count: json?.count ?? null };
  } catch (e: any) {
    return { data: null, error: { message: e?.message ?? "Network error" } };
  }
}

// Same chainable shape as the browser client's plexo.from(...).
function from(table: string) {
  const state: any = { table, action: "select", columns: "*", filters: [], or: [], order: [], returning: true };
  const self: any = {
    select(columns = "*", o: any = {}) { state.columns = columns; state.count = o.count; state.head = o.head; state.returning = true; return self; },
    insert(values: any) { state.action = "insert"; state.values = values; state.returning = false; return self; },
    upsert(values: any, o: any = {}) { state.action = "upsert"; state.values = values; state.onConflict = o.onConflict; state.ignoreDuplicates = o.ignoreDuplicates; state.returning = false; return self; },
    update(values: any) { state.action = "update"; state.values = values; state.returning = false; return self; },
    delete() { state.action = "delete"; state.returning = false; return self; },
    order(column: string, o: any = {}) { state.order.push({ column, ascending: o.ascending ?? true, nullsFirst: o.nullsFirst }); return self; },
    limit(n: number) { state.limit = n; return self; },
    range(a: number, b: number) { state.offset = a; state.limit = b - a + 1; return self; },
    single() { state.single = "single"; return self; },
    maybeSingle() { state.single = "maybeSingle"; return self; },
    or(expr: string) { state.or.push(expr); return self; },
    not(column: string, op: string, value: unknown) { state.filters.push({ column, op, value, negate: true }); return self; },
    match(values: Record<string, unknown>) { for (const [column, value] of Object.entries(values)) state.filters.push({ column, op: "eq", value }); return self; },
    then(resolve: any, reject: any) {
      return call(`/rest/${encodeURIComponent(table)}`, { method: "POST", body: JSON.stringify(state) }).then(resolve, reject);
    },
  };
  for (const op of ["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "in", "is", "contains", "containedBy", "overlaps", "textSearch"]) {
    self[op] = (column: string, value: unknown) => { state.filters.push({ column, op, value }); return self; };
  }
  return self;
}

const db = {
  from,
  rpc: (fn: string, args: Record<string, unknown> = {}) => call(`/rpc/${encodeURIComponent(fn)}`, { method: "POST", body: JSON.stringify(args) }),
  sql: (query: string, params: unknown[] = []) => call(`/_service/sql`, { method: "POST", body: JSON.stringify({ query, params }) }),
};

let envPromise: Promise<Record<string, string>> | null = null;
function loadEnv(): Promise<Record<string, string>> {
  // Secrets are fetched (decrypted server-side) on cold start rather than baked into the
  // Lambda's environment: no 4 KB env limit, and a changed secret takes effect on the next
  // cold start without redeploying the function.
  envPromise ??= call("/_service/secrets").then(({ data, error }) => {
    if (error) throw new Error(`Couldn't load secrets: ${error.message}`);
    const secrets = (data ?? {}) as Record<string, string>;
    for (const [k, v] of Object.entries(secrets)) if (process.env[k] === undefined) process.env[k] = v;
    return secrets;
  });
  return envPromise;
}

async function sendEmail(input: { to: string | string[]; subject: string; html?: string; text?: string; replyTo?: string }) {
  const { error } = await call("/_service/email", { method: "POST", body: JSON.stringify(input) });
  if (error) throw new Error(error.message);
}

export function createHandler(userHandler: (req: Request, ctx: any) => Promise<Response> | Response, name: string) {
  return async (event: InvokeEvent): Promise<InvokeResult> => {
    let env: Record<string, string>;
    try {
      env = await loadEnv();
    } catch (err: any) {
      envPromise = null;
      return toResult(Response.json({ error: { message: err.message } }, { status: 500 }));
    }
    const req =
      event.kind === "http"
        ? new Request(event.url, {
            method: event.method,
            headers: event.headers,
            body: event.bodyBase64 && !["GET", "HEAD"].includes(event.method) ? Buffer.from(event.bodyBase64, "base64") : undefined,
          })
        : new Request(`https://schedule.plexo.invalid/${name}`, { method: "POST", body: JSON.stringify({ scheduledAt: event.scheduledAt }) });
    const ctx = { user: event.kind === "http" ? event.user : null, db, env, sendEmail };
    try {
      const res = await userHandler(req, ctx);
      if (!(res instanceof Response)) {
        return toResult(Response.json({ error: { message: `Function "${name}" must return a Response (for example: return Response.json({ ok: true })).` } }, { status: 500 }));
      }
      return toResult(res);
    } catch (err: any) {
      console.error(err);
      return toResult(Response.json({ error: { message: err?.message ?? "The function failed." } }, { status: 500 }));
    }
  };
}

async function toResult(res: Response | Promise<Response>): Promise<InvokeResult> {
  const r = await res;
  const headers: Record<string, string> = {};
  r.headers.forEach((v, k) => (headers[k] = v));
  const body = Buffer.from(await r.arrayBuffer());
  return { status: r.status, headers, bodyBase64: body.toString("base64") };
}
