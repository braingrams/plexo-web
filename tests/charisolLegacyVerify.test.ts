import { generateKeyPairSync, sign } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "@better-auth/utils/password";

const { store, rateLimit } = vi.hoisted(() => ({
  store: new Map<string, import("./userStoreMock").FakeUser>(),
  rateLimit: vi.fn<(key: string, limit: number, windowMs?: number) => Promise<boolean>>(async () => true),
}));

vi.mock("@/lib/db/coreEntities", async () => {
  const { createFakeUserEntity } = await import("./userStoreMock");
  return { User: createFakeUserEntity(store) };
});
vi.mock("@/lib/commerceRateLimitDynamo", () => ({
  checkCommerceRateLimit: rateLimit,
  clientIp: () => "203.0.113.9",
}));

import { POST } from "@/app/api/charisol/legacy-verify/route";
import { resetVerifierKeyCache } from "@/server/charisolLegacyVerify";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();

function signedRequest(payload: unknown, opts: { timestamp?: number; tamperBody?: string; signWith?: typeof privateKey; omitSignature?: boolean } = {}) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const timestamp = String(opts.timestamp ?? Math.floor(Date.now() / 1000));
  const signature = sign(null, Buffer.from(`${timestamp}.${body}`), opts.signWith ?? privateKey).toString("base64");
  const headers: Record<string, string> = { "content-type": "application/json", "x-charisol-timestamp": timestamp };
  if (!opts.omitSignature) headers["x-charisol-signature"] = signature;
  return new NextRequest("https://plexo.test/api/charisol/legacy-verify", {
    method: "POST",
    headers,
    body: opts.tamperBody ?? body,
  });
}

async function call(req: NextRequest) {
  const res = await POST(req);
  return { status: res.status, json: await res.json() };
}

beforeEach(async () => {
  store.clear();
  rateLimit.mockClear();
  rateLimit.mockResolvedValue(true);
  resetVerifierKeyCache();
  process.env.CHARISOL_VERIFIER_PUBLIC_KEY_PEM = publicPem;
  store.set("u-ok", { id: "u-ok", email: "ada@example.com", name: "Ada", image: "http://pic", passwordHash: await hashPassword("correct horse"), isConfirmed: true });
});

afterEach(() => {
  delete process.env.CHARISOL_VERIFIER_PUBLIC_KEY_PEM;
  vi.unstubAllGlobals();
});

describe("legacy-verify: caller authentication", () => {
  const good = { mode: "password", email: "ada@example.com", password: "correct horse" };

  it("401 when the signature header is missing", async () => {
    expect((await call(signedRequest(good, { omitSignature: true }))).status).toBe(401);
  });

  it("401 when signed with the wrong key", async () => {
    const other = generateKeyPairSync("ed25519").privateKey;
    expect((await call(signedRequest(good, { signWith: other }))).status).toBe(401);
  });

  it("401 when the body was altered after signing (raw body is what is verified)", async () => {
    const req = signedRequest(good, { tamperBody: JSON.stringify({ ...good, email: "victim@example.com" }) });
    expect((await call(req)).status).toBe(401);
  });

  it("401 for a stale or future timestamp", async () => {
    const now = Math.floor(Date.now() / 1000);
    expect((await call(signedRequest(good, { timestamp: now - 61 }))).status).toBe(401);
    expect((await call(signedRequest(good, { timestamp: now + 120 }))).status).toBe(401);
  });

  it("fails closed (401) when no public key is available", async () => {
    delete process.env.CHARISOL_VERIFIER_PUBLIC_KEY_PEM;
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    expect((await call(signedRequest(good))).status).toBe(401);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    expect((await call(signedRequest(good))).status).toBe(401);
  });

  it("fetches the published key once and caches it", async () => {
    delete process.env.CHARISOL_VERIFIER_PUBLIC_KEY_PEM;
    const fetchMock = vi.fn(async (_url: string | URL | Request) => new Response(publicPem, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await call(signedRequest(good))).status).toBe(200);
    expect((await call(signedRequest(good))).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://developers.charisol.io/charisol-legacy-verifier-public-key.pem");
  });

  it("does not touch the database or rate limiter before the signature passes", async () => {
    await call(signedRequest(good, { omitSignature: true }));
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it("400 for a signed but malformed request", async () => {
    expect((await call(signedRequest("not json"))).status).toBe(400);
    expect((await call(signedRequest({ mode: "other", email: "a@b.c" }))).status).toBe(400);
    expect((await call(signedRequest({ mode: "password", email: "a@b.c" }))).status).toBe(400);
  });
});

describe("legacy-verify: credentials", () => {
  it("happy path: returns id, lowercased email, emailVerified, name, picture", async () => {
    const { status, json } = await call(signedRequest({ mode: "password", email: "  Ada@Example.com ", password: "correct horse" }));
    expect(status).toBe(200);
    expect(json).toEqual({ valid: true, email: "ada@example.com", emailVerified: true, userId: "u-ok", name: "Ada", picture: "http://pic" });
  });

  it("wrong password and unknown email give the identical response", async () => {
    const wrong = await call(signedRequest({ mode: "password", email: "ada@example.com", password: "nope" }));
    const unknown = await call(signedRequest({ mode: "password", email: "nobody@example.com", password: "nope" }));
    expect(wrong).toEqual({ status: 200, json: { valid: false } });
    expect(unknown).toEqual(wrong);
  });

  it("suspended user is not valid", async () => {
    store.get("u-ok")!.suspendedAt = "2026-01-01";
    expect((await call(signedRequest({ mode: "password", email: "ada@example.com", password: "correct horse" }))).json).toEqual({ valid: false });
    expect((await call(signedRequest({ mode: "lookup", email: "ada@example.com" }))).json).toEqual({ valid: false });
  });

  it("Google-only user (no local password) is not valid in password mode", async () => {
    store.set("g", { id: "g", email: "g@example.com", name: "G", passwordHash: "", isConfirmed: true });
    expect((await call(signedRequest({ mode: "password", email: "g@example.com", password: "anything" }))).json).toEqual({ valid: false });
  });

  it("unconfirmed account is denied even with the right password (anyone can register any email)", async () => {
    store.set("un", { id: "un", email: "un@example.com", name: "Un", passwordHash: await hashPassword("pw-12345678"), isConfirmed: false });
    const { json } = await call(signedRequest({ mode: "password", email: "un@example.com", password: "pw-12345678" }));
    expect(json).toEqual({ valid: false });
  });

  it("unconfirmed account with no password is denied, even in lookup mode", async () => {
    store.set("un2", { id: "un2", email: "un2@example.com", name: "Un2", passwordHash: "", isConfirmed: false });
    expect((await call(signedRequest({ mode: "lookup", email: "un2@example.com" }))).json).toEqual({ valid: false });
  });

  it("a password equal to the account's own email is never accepted", async () => {
    store.set("e", { id: "e", email: "e@example.com", name: "E", passwordHash: await hashPassword("e@example.com"), isConfirmed: true });
    expect((await call(signedRequest({ mode: "password", email: "e@example.com", password: "E@example.com" }))).json).toEqual({ valid: false });
  });

  it("lookup mode skips the password check for an allowed account", async () => {
    const { json } = await call(signedRequest({ mode: "lookup", email: "ada@example.com" }));
    expect(json).toMatchObject({ valid: true, emailVerified: true, userId: "u-ok" });
    expect((await call(signedRequest({ mode: "lookup", email: "nobody@example.com" }))).json).toEqual({ valid: false });
  });

  it("rate-limited requests answer 200 {valid:false} without checking the password", async () => {
    rateLimit.mockResolvedValue(false);
    const res = await call(signedRequest({ mode: "password", email: "ada@example.com", password: "correct horse" }));
    expect(res).toEqual({ status: 200, json: { valid: false } });
  });

  it("rate-limits per email (and per IP)", async () => {
    await call(signedRequest({ mode: "password", email: "ada@example.com", password: "x" }));
    const keys = rateLimit.mock.calls.map((c) => c[0]);
    expect(keys).toContain("legacy-verify:ada@example.com");
    expect(keys).toContain("legacy-verify-ip:203.0.113.9");
  });
});
