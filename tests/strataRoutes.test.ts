import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// "Connect Strata": the session route (verify the Charisol token, match the Plexo account,
// store the Strata session encrypted, report expiry) and the routes that proxy Strata for the
// editor's Branding panel.

const state = vi.hoisted(() => ({
  userId: "u1" as string | null,
  userEmail: "ada@example.com",
  links: new Map<string, { userId: string; ciphertext: string; storedAt: string }>(),
  rows: new Map<string, { userId: string; ciphertext: string; strataEmail?: string; strataName?: string; connectedAt: string }>(),
  claims: { email: "ada@example.com", email_verified: true } as Record<string, unknown>,
  verifyFails: false,
  rateLimited: false,
}));

vi.mock("@/lib/auth/resolveUser", () => ({
  resolveUser: async () => (state.userId ? { userId: state.userId, organizationId: "org1", role: null, subscriptionPlan: "FREE", customDomainLimit: null, manageLandingPagePublishing: false } : null),
}));
vi.mock("@/lib/commerceRateLimitDynamo", () => ({ checkCommerceRateLimit: async () => !state.rateLimited }));
vi.mock("@/lib/db/coreEntities", () => ({
  User: { get: () => ({ go: async () => ({ data: { id: state.userId, email: state.userEmail } }) }) },
  CharisolLink: {
    get: ({ userId }: { userId: string }) => ({ go: async () => ({ data: state.links.get(userId) ?? null }) }),
    upsert: (item: { userId: string; ciphertext: string; storedAt: string }) => ({ go: async () => { state.links.set(item.userId, item); return { data: item }; } }),
    delete: ({ userId }: { userId: string }) => ({ go: async () => void state.links.delete(userId) }),
  },
  StrataSession: {
    get: ({ userId }: { userId: string }) => ({ go: async () => ({ data: state.rows.get(userId) ?? null }) }),
    upsert: (item: { userId: string; ciphertext: string; connectedAt: string }) => ({
      go: async () => {
        state.rows.set(item.userId, item);
        return { data: item };
      },
    }),
    delete: ({ userId }: { userId: string }) => ({ go: async () => void state.rows.delete(userId) }),
  },
}));
vi.mock("@/server/charisolVerifier", () => ({
  getCharisolVerifier: () => ({
    verify: async () => {
      if (state.verifyFails) throw new Error("bad signature");
      return state.claims;
    },
  }),
}));
vi.mock("@/server/charisolAccount", () => ({ isEmailVerifiedClaim: (v: unknown) => v === true || v === "true" }));

import { GET as getSession, POST as postSession, DELETE as deleteSession } from "@/app/api/v1/strata/session/route";
import { GET as listProjects, POST as createProject } from "@/app/api/v1/strata/projects/route";
import { GET as pull, PUT as push } from "@/app/api/v1/strata/projects/[id]/design-system/route";
import { STRATA_SESSION_MAX_AGE_MS, loadStrataToken } from "@/lib/strata/session";

const SECRET_TOKEN = "strata.jwt.SECRET-VALUE";
const strataCalls: Array<{ url: string; init: RequestInit }> = [];
let strataHandler: (url: string, init: RequestInit) => Response;

const req = (path: string, method = "GET", body?: unknown) =>
  new NextRequest(`https://plexo.test/api/v1/strata${path}`, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function connectedRow(ageMs = 0) {
  return { userId: "u1", ciphertext: "x", strataEmail: "ada@example.com", strataName: "Ada L", connectedAt: new Date(Date.now() - ageMs).toISOString() };
}
describe("connecting with the Charisol sign-in Plexo kept (no window)", () => {
  const cognito = (status: number, body: unknown = {}) => (url: string) => (url.includes("/oauth2/token") ? json(status, body) : json(200, { status: true, data: { token: SECRET_TOKEN, user: { email: "ada@example.com", firstName: "Ada" } } }));

  it("turns the saved sign-in into a Strata session, with nothing typed", async () => {
    const { saveCharisolRefresh } = await import("@/lib/charisolLink");
    await saveCharisolRefresh("u1", "refresh.tok");
    strataHandler = cognito(200, { id_token: "fresh.id" });
    const res = await postSession(req("/session", "POST", { silent: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ connected: true, user: { email: "ada@example.com" } });
    const refresh = strataCalls.find((c) => c.url.includes("/oauth2/token"))!;
    expect(String(refresh.init.body)).toContain("grant_type=refresh_token");
    expect(await loadStrataToken("u1")).toBe(SECRET_TOKEN);
  });

  it("asks for one sign-in when there is none saved", async () => {
    const res = await postSession(req("/session", "POST", { silent: true }));
    expect(res.status).toBe(409);
    expect((await res.json()).kind).toBe("needs_sign_in");
  });

  it("forgets a sign-in Charisol no longer honours", async () => {
    const { saveCharisolRefresh } = await import("@/lib/charisolLink");
    await saveCharisolRefresh("u1", "refresh.tok");
    strataHandler = cognito(400, { error: "invalid_grant" });
    expect((await postSession(req("/session", "POST", { silent: true }))).status).toBe(409);
    expect(state.links.has("u1")).toBe(false);
  });

  it("never connects Strata as someone else: the renewed token must carry this person's email", async () => {
    const { saveCharisolRefresh } = await import("@/lib/charisolLink");
    await saveCharisolRefresh("u1", "someone-elses.refresh");
    state.claims = { email: "mallory@example.com", email_verified: true };
    strataHandler = cognito(200, { id_token: "their.id" });
    expect((await postSession(req("/session", "POST", { silent: true }))).status).toBe(403);
    expect(state.rows.size).toBe(0);
  });
});

describe("connecting with an email and password (another Strata account)", () => {
  it("signs in to Strata with them, stores only the session, and never keeps the password", async () => {
    strataHandler = () => json(200, { status: true, data: { token: SECRET_TOKEN, user: { email: "other@example.com", firstName: "Oto" } } });
    const res = await postSession(req("/session", "POST", { email: " other@example.com ", password: "hunter22" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ connected: true, user: { email: "other@example.com", name: "Oto" } });
    expect(strataCalls[0].url).toBe("https://strata.test/v1/auth/login");
    expect(JSON.parse(String(strataCalls[0].init.body))).toEqual({ email: "other@example.com", password: "hunter22" });
    expect(JSON.stringify([...state.rows.values()])).not.toContain("hunter22");
    expect(await loadStrataToken("u1")).toBe(SECRET_TOKEN);
  });

  it("says plainly when Strata does not accept them, and needs both fields", async () => {
    strataHandler = () => json(401, { status: false, message: "Invalid email or password.", data: {} });
    const bad = await postSession(req("/session", "POST", { email: "a@b.co", password: "nope" }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("Invalid email or password.");
    const half = await postSession(req("/session", "POST", { email: "a@b.co" }));
    expect(half.status).toBe(400);
    expect((await half.json()).error).toMatch(/both/i);
  });

  it("lets a Google sign-in for another Strata account through only when the person chose that", async () => {
    state.claims = { email: "other@example.com", email_verified: true };
    strataHandler = () => json(200, { status: true, data: { token: SECRET_TOKEN, user: { email: "other@example.com" } } });
    expect((await postSession(req("/session", "POST", { idToken: "t" }))).status).toBe(403);
    expect((await postSession(req("/session", "POST", { idToken: "t", anotherAccount: true }))).status).toBe(200);
  });

  it("GET tells the sign-in window which Plexo email to start from", async () => {
    expect(await (await getSession(req("/session"))).json()).toMatchObject({ plexoEmail: "ada@example.com" });
  });
});

async function connect() {
  strataHandler = () => json(200, { status: true, data: { token: SECRET_TOKEN, user: { email: "ada@example.com", firstName: "Ada", lastName: "L" } } });
  return postSession(req("/session", "POST", { idToken: "id.token" }));
}

beforeEach(() => {
  process.env.STRATA_API_URL = "https://strata.test/v1/";
  process.env.STRATA_TOKEN_ENCRYPTION_SECRET = "test-secret-for-strata-tokens";
  Object.assign(state, { userId: "u1", userEmail: "ada@example.com", claims: { email: "ada@example.com", email_verified: true }, verifyFails: false, rateLimited: false });
  state.rows.clear();
  state.links.clear();
  strataCalls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      strataCalls.push({ url, init });
      return strataHandler(url, init);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.STRATA_API_URL;
});

describe("POST /api/v1/strata/session", () => {
  it("verifies the Charisol token, trades it for a Strata session and stores it encrypted", async () => {
    const res = await connect();
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ available: true, connected: true, expired: false, user: { email: "ada@example.com", name: "Ada L" } });
    expect(text).not.toContain(SECRET_TOKEN);
    expect(strataCalls[0].url).toBe("https://strata.test/v1/auth/charisol-id-token");
    expect(JSON.parse(String(strataCalls[0].init.body))).toEqual({ idToken: "id.token" });
    const row = state.rows.get("u1")!;
    expect(row.ciphertext).not.toContain(SECRET_TOKEN);
    expect(JSON.stringify(row)).not.toContain(SECRET_TOKEN);
    expect(await loadStrataToken("u1")).toBe(SECRET_TOKEN);
  });

  it("rejects a Charisol account whose email isn't the signed-in Plexo user's, without calling Strata", async () => {
    state.claims = { email: "someone.else@example.com", email_verified: true };
    const res = await connect();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/isn't the one you use for Plexo/);
    expect(strataCalls).toHaveLength(0);
    expect(state.rows.size).toBe(0);
  });

  it("matches emails ignoring case, and refuses an unverified email", async () => {
    state.claims = { email: "ADA@Example.com", email_verified: true };
    expect((await connect()).status).toBe(200);
    state.rows.clear();
    state.claims = { email: "ada@example.com", email_verified: false };
    expect((await connect()).status).toBe(403);
  });

  it("rejects a token that fails verification", async () => {
    state.verifyFails = true;
    const res = await postSession(req("/session", "POST", { idToken: "forged" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/couldn't be verified/);
    expect(strataCalls).toHaveLength(0);
  });

  it("needs a token in the body", async () => {
    expect((await postSession(req("/session", "POST", {}))).status).toBe(400);
  });

  it("turns a Strata failure into a plain message and stores nothing", async () => {
    strataHandler = () => json(401, { status: false, message: "Invalid or expired Charisol token" });
    const res = await postSession(req("/session", "POST", { idToken: "id.token" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/didn't accept your Charisol sign-in/);
    strataHandler = () => json(503, { status: false });
    const down = await postSession(req("/session", "POST", { idToken: "id.token" }));
    expect(down.status).toBe(502);
    expect((await down.json()).error).toMatch(/isn't available right now/);
    expect(state.rows.size).toBe(0);
  });

  it("needs a signed-in Plexo user, and is rate limited", async () => {
    state.userId = null;
    expect((await connect()).status).toBe(401);
    state.userId = "u1";
    state.rateLimited = true;
    expect((await connect()).status).toBe(429);
  });
});

describe("GET/DELETE /api/v1/strata/session", () => {
  it("reports not connected, connected, then expired after ~23 hours — never the token", async () => {
    expect(await (await getSession(req("/session"))).json()).toMatchObject({ available: true, connected: false, expired: false });
    state.rows.set("u1", connectedRow());
    const connected = await (await getSession(req("/session"))).json();
    expect(connected).toMatchObject({ available: true, connected: true, expired: false, user: { email: "ada@example.com", name: "Ada L" } });
    state.rows.set("u1", connectedRow(STRATA_SESSION_MAX_AGE_MS + 1000));
    const expired = await (await getSession(req("/session"))).json();
    expect(expired).toMatchObject({ connected: false, expired: true });
    expect(JSON.stringify(expired)).not.toMatch(/ciphertext|token/i);
    expect(await loadStrataToken("u1")).toBeNull();
  });

  it("says Strata isn't available when STRATA_API_URL is unset, instead of failing", async () => {
    delete process.env.STRATA_API_URL;
    const res = await getSession(req("/session"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: false, connected: false, expired: false });
  });

  it("disconnects", async () => {
    await connect();
    const res = await deleteSession(req("/session", "DELETE"));
    expect(await res.json()).toMatchObject({ connected: false });
    expect(state.rows.size).toBe(0);
  });
});

describe("Strata project routes", () => {
  beforeEach(async () => {
    await connect();
    strataCalls.length = 0;
  });

  it("lists projects, calling Strata with the stored token", async () => {
    strataHandler = () => json(200, { status: true, data: [{ projectId: "p1", title: "Acme", role: "owner" }] });
    const res = await listProjects(req("/projects"));
    expect(await res.json()).toEqual({ projects: [{ id: "p1", name: "Acme", description: null, updatedAt: undefined, color: null, logo: null, role: "owner" }].map((p) => JSON.parse(JSON.stringify(p))) });
    expect(strataCalls[0].url).toBe("https://strata.test/v1/user/projects");
    expect((strataCalls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET_TOKEN}`);
  });

  it("creates a project from a template, and checks the input", async () => {
    strataHandler = () => json(200, { status: true, data: { projectId: "p2", title: "Brand" } });
    const res = await createProject(req("/projects", "POST", { name: " Brand ", template: "base", brandPrimary: "#112233" }));
    expect(res.status).toBe(201);
    expect((await res.json()).project).toMatchObject({ id: "p2", name: "Brand" });
    expect(strataCalls[0].url).toBe("https://strata.test/v1/projects?preset=base");
    expect(JSON.parse(String(strataCalls[0].init.body))).toEqual({ name: "Brand", brandPrimary: "#112233" });
    expect((await createProject(req("/projects", "POST", { name: "", template: "blank" }))).status).toBe(400);
    expect((await createProject(req("/projects", "POST", { name: "x", template: "weird" }))).status).toBe(400);
  });

  it("pulls a design system as a snapshot", async () => {
    strataHandler = () => json(200, { data: { revision: "r1", variables: [{ key: "--c", name: "C", value: "#fff", type: "color", layer: "brand" }], components: [] } });
    const res = await pull(req("/projects/p1/design-system"), ctx("p1"));
    expect(await res.json()).toMatchObject({ revision: "r1", tokens: [{ key: "--c", value: "#fff" }], components: [] });
    expect(strataCalls[0].url).toBe("https://strata.test/v1/projects/p1/design-system");
  });

  it("pushes with the base revision, and maps a conflict to 409", async () => {
    strataHandler = () => json(200, { data: { revision: "r2" } });
    const ok = await push(req("/projects/p1/design-system", "PUT", { variables: [], components: [], baseRevision: "r1" }), ctx("p1"));
    expect(await ok.json()).toEqual({ revision: "r2" });
    expect(strataCalls[0].init.method).toBe("PUT");
    expect(JSON.parse(String(strataCalls[0].init.body))).toMatchObject({ baseRevision: "r1" });

    strataHandler = () => json(409, { error: { code: "REVISION_CONFLICT" } });
    const conflict = await push(req("/projects/p1/design-system", "PUT", { variables: [], components: [] }), ctx("p1"));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ kind: "conflict" });
    expect((await push(req("/projects/p1/design-system", "PUT", { nope: 1 }), ctx("p1"))).status).toBe(400);
  });

  it("maps Strata's errors to plain messages and statuses", async () => {
    for (const [status, kind, httpStatus] of [
      [401, "expired", 401],
      [403, "forbidden", 403],
      [404, "not_found", 404],
      [500, "server", 502],
    ] as const) {
      strataHandler = () => json(status, {});
      const res = await pull(req("/projects/p1/design-system"), ctx("p1"));
      expect(res.status).toBe(httpStatus);
      const body = await res.json();
      expect(body.kind).toBe(kind);
      expect(body.error).not.toMatch(/^\d{3}$|Bad Request/);
    }
    strataHandler = () => {
      throw new TypeError("fetch failed");
    };
    const net = await pull(req("/projects/p1/design-system"), ctx("p1"));
    expect(net.status).toBe(502);
    expect((await net.json()).kind).toBe("network");
  });

  it("answers an ended session with kind 'expired' so the editor can offer Reconnect — without calling Strata", async () => {
    state.rows.set("u1", connectedRow(STRATA_SESSION_MAX_AGE_MS + 1000));
    const res = await listProjects(req("/projects"));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ kind: "expired", error: expect.stringMatching(/Connect Strata/) });
    expect(strataCalls).toHaveLength(0);
  });

  it("needs a signed-in user and respects the rate limit; says so plainly when Strata isn't set up", async () => {
    state.userId = null;
    expect((await listProjects(req("/projects"))).status).toBe(401);
    state.userId = "u1";
    state.rateLimited = true;
    expect((await listProjects(req("/projects"))).status).toBe(429);
    state.rateLimited = false;
    delete process.env.STRATA_API_URL;
    const res = await listProjects(req("/projects"));
    expect(res.status).toBe(503);
    expect((await res.json()).kind).toBe("unavailable");
  });
});
