// Plexo client — your app's backend: database, sign-in, server functions, and file storage.
// Works the same way on your live site, on preview links, and locally (`npm run dev` with
// PLEXO_URL set). Usage mirrors the Supabase client:
//
//   const { data, error } = await plexo.from("todos").select("*").eq("done", false).order("created_at");
//   await plexo.from("todos").insert({ title: "Buy milk" });
//   await plexo.auth.signInWithPassword({ email, password });
//   const { data } = await plexo.functions.invoke("send-welcome", { body: { name } });
//
// Sessions are held in a secure, http-only cookie on your own domain — no tokens in
// localStorage — so there's nothing to store or refresh yourself.

const BASE = ((import.meta as any).env?.VITE_PLEXO_API_URL as string | undefined) ?? "/__plexo/api";

export type PlexoError = { message: string; code?: string; hint?: string; status?: number };
export type PlexoResponse<T> = { data: T | null; error: PlexoError | null; count?: number | null };

async function request<T>(path: string, init: RequestInit = {}): Promise<PlexoResponse<T> & { raw?: any }> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      credentials: "include",
      ...init,
      headers: { ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const err = json?.error ?? {};
      return { data: null, error: { message: err.message ?? `Request failed (${res.status})`, code: err.code, hint: err.hint, status: res.status } };
    }
    return { data: (json?.data ?? null) as T, error: null, count: json?.count ?? null, raw: json };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : "Network error — check your connection.", code: "network_error" } };
  }
}

// ------------------------------------------------------------------ database

type FilterOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "like" | "ilike" | "in" | "is" | "contains" | "containedBy" | "overlaps" | "textSearch";
type Filter = { column: string; op: FilterOp; value: unknown; negate?: boolean };
type Order = { column: string; ascending: boolean; nullsFirst?: boolean; foreignTable?: string };

type QueryState = {
  table: string;
  action: "select" | "insert" | "update" | "upsert" | "delete";
  columns: string;
  filters: Filter[];
  or: string[];
  order: Order[];
  limit?: number;
  offset?: number;
  count?: "exact";
  head?: boolean;
  single?: "single" | "maybeSingle";
  values?: unknown;
  onConflict?: string;
  ignoreDuplicates?: boolean;
  returning: boolean;
};

class QueryBuilder<T = any> implements PromiseLike<PlexoResponse<T>> {
  constructor(private state: QueryState) {}

  private with(patch: Partial<QueryState>): QueryBuilder<T> {
    return new QueryBuilder<T>({ ...this.state, ...patch });
  }
  private filter(column: string, op: FilterOp, value: unknown, negate = false) {
    return this.with({ filters: [...this.state.filters, { column, op, value, negate }] });
  }

  /** Columns to return. Related rows: select("*, author:profiles(name, avatar_url)"). */
  select(columns = "*", options: { count?: "exact"; head?: boolean } = {}): QueryBuilder<T> {
    return this.with({ columns, count: options.count, head: options.head, returning: true });
  }
  insert(values: Partial<T> | Partial<T>[]): QueryBuilder<T> {
    return this.with({ action: "insert", values, returning: false });
  }
  upsert(values: Partial<T> | Partial<T>[], options: { onConflict?: string; ignoreDuplicates?: boolean } = {}): QueryBuilder<T> {
    return this.with({ action: "upsert", values, onConflict: options.onConflict, ignoreDuplicates: options.ignoreDuplicates, returning: false });
  }
  update(values: Partial<T>): QueryBuilder<T> {
    return this.with({ action: "update", values, returning: false });
  }
  delete(): QueryBuilder<T> {
    return this.with({ action: "delete", returning: false });
  }

  eq(column: string, value: unknown) { return this.filter(column, "eq", value); }
  neq(column: string, value: unknown) { return this.filter(column, "neq", value); }
  gt(column: string, value: unknown) { return this.filter(column, "gt", value); }
  gte(column: string, value: unknown) { return this.filter(column, "gte", value); }
  lt(column: string, value: unknown) { return this.filter(column, "lt", value); }
  lte(column: string, value: unknown) { return this.filter(column, "lte", value); }
  like(column: string, pattern: string) { return this.filter(column, "like", pattern); }
  ilike(column: string, pattern: string) { return this.filter(column, "ilike", pattern); }
  in(column: string, values: unknown[]) { return this.filter(column, "in", values); }
  is(column: string, value: null | boolean) { return this.filter(column, "is", value); }
  contains(column: string, value: unknown) { return this.filter(column, "contains", value); }
  containedBy(column: string, value: unknown) { return this.filter(column, "containedBy", value); }
  overlaps(column: string, value: unknown) { return this.filter(column, "overlaps", value); }
  textSearch(column: string, query: string) { return this.filter(column, "textSearch", query); }
  not(column: string, op: FilterOp, value: unknown) { return this.filter(column, op, value, true); }
  match(values: Record<string, unknown>) {
    return this.with({ filters: [...this.state.filters, ...Object.entries(values).map(([column, value]) => ({ column, op: "eq" as const, value }))] });
  }
  /** PostgREST-style OR: .or("status.eq.open,priority.gt.3") */
  or(expression: string) { return this.with({ or: [...this.state.or, expression] }); }

  order(column: string, options: { ascending?: boolean; nullsFirst?: boolean; foreignTable?: string } = {}) {
    return this.with({ order: [...this.state.order, { column, ascending: options.ascending ?? true, nullsFirst: options.nullsFirst, foreignTable: options.foreignTable }] });
  }
  limit(count: number) { return this.with({ limit: count }); }
  range(from: number, to: number) { return this.with({ offset: from, limit: to - from + 1 }); }
  single(): QueryBuilder<T> { return this.with({ single: "single" }); }
  maybeSingle(): QueryBuilder<T> { return this.with({ single: "maybeSingle" }); }

  then<R1 = PlexoResponse<T>, R2 = never>(onfulfilled?: ((value: PlexoResponse<T>) => R1 | PromiseLike<R1>) | null, onrejected?: ((reason: any) => R2 | PromiseLike<R2>) | null): PromiseLike<R1 | R2> {
    return request<T>(`/rest/${encodeURIComponent(this.state.table)}`, { method: "POST", body: JSON.stringify(this.state) })
      .then(({ data, error, count }) => ({ data, error, count }))
      .then(onfulfilled, onrejected);
  }
}

// ------------------------------------------------------------------ auth

export type PlexoUser = {
  id: string;
  email: string;
  role: string;
  email_verified: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
};
export type AuthEvent = "SIGNED_IN" | "SIGNED_OUT" | "USER_UPDATED";
type AuthListener = (event: AuthEvent, user: PlexoUser | null) => void;

const listeners = new Set<AuthListener>();
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("plexo-auth") : null;
function emit(event: AuthEvent, user: PlexoUser | null, broadcast = true) {
  listeners.forEach((l) => l(event, user));
  if (broadcast) channel?.postMessage({ event, user });
}
channel?.addEventListener("message", (e) => emit(e.data.event, e.data.user, false));

const auth = {
  async signUp(input: { email: string; password: string; data?: Record<string, unknown>; redirectTo?: string }) {
    const res = await request<{ user: PlexoUser | null; needsEmailConfirmation: boolean }>("/auth/signup", { method: "POST", body: JSON.stringify(input) });
    if (res.data?.user) emit("SIGNED_IN", res.data.user);
    return { data: res.data, error: res.error };
  },
  async signInWithPassword(input: { email: string; password: string }) {
    const res = await request<{ user: PlexoUser }>("/auth/login", { method: "POST", body: JSON.stringify(input) });
    if (res.data?.user) emit("SIGNED_IN", res.data.user);
    return { data: res.data, error: res.error };
  },
  /** Emails a one-click sign-in link. */
  async signInWithOtp(input: { email: string; redirectTo?: string; data?: Record<string, unknown> }) {
    const res = await request<{ sent: boolean }>("/auth/magic-link", { method: "POST", body: JSON.stringify({ ...input, redirectTo: input.redirectTo ?? location.href }) });
    return { data: res.data, error: res.error };
  },
  /** Sends a visitor to Google (or another enabled provider) to sign in. */
  signInWithOAuth(input: { provider: "google"; redirectTo?: string }) {
    const to = encodeURIComponent(input.redirectTo ?? location.href);
    location.assign(`${BASE}/auth/oauth/${input.provider}?redirectTo=${to}`);
  },
  async signOut() {
    const res = await request<null>("/auth/logout", { method: "POST" });
    emit("SIGNED_OUT", null);
    return { error: res.error };
  },
  async getUser() {
    const res = await request<{ user: PlexoUser | null }>("/auth/session");
    return { data: { user: res.data?.user ?? null }, error: res.error };
  },
  async resetPasswordForEmail(email: string, options: { redirectTo?: string } = {}) {
    const res = await request<{ sent: boolean }>("/auth/recover", { method: "POST", body: JSON.stringify({ email, redirectTo: options.redirectTo ?? `${location.origin}/reset-password` }) });
    return { data: res.data, error: res.error };
  },
  /** On your reset-password page: completes a reset from the emailed link's ?token=. */
  async resetPassword(input: { token: string; password: string }) {
    const res = await request<{ user: PlexoUser }>("/auth/reset", { method: "POST", body: JSON.stringify(input) });
    if (res.data?.user) emit("SIGNED_IN", res.data.user);
    return { data: res.data, error: res.error };
  },
  async updateUser(input: { password?: string; currentPassword?: string; data?: Record<string, unknown> }) {
    const res = await request<{ user: PlexoUser }>("/auth/update", { method: "POST", body: JSON.stringify(input) });
    if (res.data?.user) emit("USER_UPDATED", res.data.user);
    return { data: res.data, error: res.error };
  },
  onAuthStateChange(listener: AuthListener) {
    listeners.add(listener);
    return { unsubscribe: () => listeners.delete(listener) };
  },
};

// ------------------------------------------------------------------ functions

const functions = {
  /** Calls a server function from functions/<name>.ts. */
  async invoke<T = any>(name: string, options: { body?: unknown; method?: "POST" | "GET" } = {}) {
    const res = await request<T>(`/fn/${encodeURIComponent(name)}`, {
      method: options.method ?? "POST",
      body: options.body === undefined || options.method === "GET" ? undefined : JSON.stringify(options.body),
    });
    return { data: res.data, error: res.error };
  },
};

// ------------------------------------------------------------------ storage

function storageBucket(bucket: string) {
  return {
    /** Uploads a file; returns its path and public URL (public buckets) for saving in a row. */
    async upload(path: string, file: File | Blob, options: { contentType?: string; upsert?: boolean } = {}) {
      const contentType = options.contentType ?? (file as File).type ?? "application/octet-stream";
      const signed = await request<{ url: string; fields: Record<string, string>; path: string; publicUrl: string | null }>(
        `/storage/${encodeURIComponent(bucket)}/sign-upload`,
        { method: "POST", body: JSON.stringify({ path, contentType, size: file.size, upsert: options.upsert ?? false }) },
      );
      if (signed.error || !signed.data) return { data: null, error: signed.error };
      const form = new FormData();
      Object.entries(signed.data.fields).forEach(([k, v]) => form.append(k, v));
      form.append("file", file);
      const res = await fetch(signed.data.url, { method: "POST", body: form });
      if (!res.ok) return { data: null, error: { message: "Upload failed — the file may be too large.", status: res.status } as PlexoError };
      return { data: { path: signed.data.path, publicUrl: signed.data.publicUrl }, error: null };
    },
    /** A time-limited link to a file in a private bucket. */
    async createSignedUrl(path: string, expiresInSeconds = 3600) {
      const res = await request<{ signedUrl: string }>(`/storage/${encodeURIComponent(bucket)}/sign-download`, {
        method: "POST",
        body: JSON.stringify({ path, expiresIn: expiresInSeconds }),
      });
      return { data: res.data, error: res.error };
    },
    async remove(paths: string[]) {
      const res = await request<{ removed: string[] }>(`/storage/${encodeURIComponent(bucket)}/remove`, { method: "POST", body: JSON.stringify({ paths }) });
      return { data: res.data, error: res.error };
    },
    async list(prefix = "") {
      const res = await request<Array<{ path: string; size: number; createdAt: string | null; publicUrl: string | null }>>(
        `/storage/${encodeURIComponent(bucket)}/list?prefix=${encodeURIComponent(prefix)}`,
      );
      return { data: res.data, error: res.error };
    },
  };
}

export const plexo = {
  from<T = any>(table: string) {
    return new QueryBuilder<T>({ table, action: "select", columns: "*", filters: [], or: [], order: [], returning: true });
  },
  /** Calls a Postgres function you defined in a migration. */
  async rpc<T = any>(fn: string, args: Record<string, unknown> = {}) {
    const res = await request<T>(`/rpc/${encodeURIComponent(fn)}`, { method: "POST", body: JSON.stringify(args) });
    return { data: res.data, error: res.error };
  },
  auth,
  functions,
  storage: { from: storageBucket },
};

export default plexo;
