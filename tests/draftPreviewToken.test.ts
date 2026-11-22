import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ root: null as any, children: [] as any[], user: null as any }));
vi.mock("@/lib/auth/resolveUser", () => ({ resolveUser: vi.fn(async () => db.user) }));
vi.mock("@/lib/db/contentEntities", () => ({
  Template: { get: () => ({ go: async () => ({ data: db.root }) }), query: { byParent: () => ({ go: async () => ({ data: db.children }) }) } },
  PublishedDomain: { query: { primary: () => ({ go: async () => ({ data: [] }) }) } },
}));

import { DRAFT_PREVIEW_TTL_SECONDS, mintDraftPreviewToken, signedDraftPreviewUrl, verifyDraftPreviewToken } from "@/lib/draftPreviewToken";
import { GET } from "@/app/api/v1/templates/[id]/draft-preview/route";
import { NextRequest } from "next/server";

const SECRET = "test-secret";
const now = 1_800_000_000_000;

describe("draft preview token", () => {
  const claim = { templateId: "t1", pageId: "p1", shot: true };
  it("verifies a fresh token", () => {
    const { sig, exp } = mintDraftPreviewToken(claim, { secret: SECRET, now });
    expect(verifyDraftPreviewToken(claim, { sig, exp }, { secret: SECRET, now })).toBe(true);
    expect(exp - now / 1000).toBe(DRAFT_PREVIEW_TTL_SECONDS);
  });
  it("expires after 5 minutes", () => {
    const { sig, exp } = mintDraftPreviewToken(claim, { secret: SECRET, now });
    expect(verifyDraftPreviewToken(claim, { sig, exp }, { secret: SECRET, now: now + 301_000 })).toBe(false);
  });
  it("cannot be stretched by changing the expiry", () => {
    const { sig, exp } = mintDraftPreviewToken(claim, { secret: SECRET, now });
    expect(verifyDraftPreviewToken(claim, { sig, exp: exp + 3600 }, { secret: SECRET, now })).toBe(false);
  });
  it("rejects tampering, another page, another site, the flag flipped, and a wrong secret", () => {
    const { sig, exp } = mintDraftPreviewToken(claim, { secret: SECRET, now });
    const ok = (c: typeof claim, s = sig, secret = SECRET) => verifyDraftPreviewToken(c, { sig: s, exp }, { secret, now });
    expect(ok({ ...claim, pageId: "p2" })).toBe(false);
    expect(ok({ ...claim, templateId: "t2" })).toBe(false);
    expect(ok({ ...claim, shot: false })).toBe(false);
    expect(ok(claim, sig.slice(0, -2) + (sig.endsWith("00") ? "11" : "00"))).toBe(false);
    expect(ok(claim, "zz")).toBe(false);
    expect(ok(claim, sig, "other-secret")).toBe(false);
    expect(verifyDraftPreviewToken(claim, { sig: null, exp: null }, { secret: SECRET, now })).toBe(false);
  });
});

describe("draft-preview route", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = "auth-secret-for-tests";
    db.user = null;
    db.root = { id: "root1", organizationId: "org1", draftHtml: "<html><body><h1>Root draft</h1></body></html>" };
    db.children = [{ id: "pg2", slug: "about", draftHtml: "<html><body><h1>About draft</h1></body></html>" }];
  });
  const call = (url: string) => GET(new NextRequest(url), { params: Promise.resolve({ id: "root1" }) });
  const signed = (claim: { templateId: string; pageId?: string | null; shot?: boolean }, o: { now?: number } = {}) => signedDraftPreviewUrl("https://app.example.com", claim, o);

  it("signed in nobody, no token: asks to sign in", async () => {
    expect((await call("https://app.example.com/api/v1/templates/root1/draft-preview")).status).toBe(401);
  });
  it("a valid token opens the draft with no sign-in, no preview bar, still sandboxed", async () => {
    const res = await call(signed({ templateId: "root1", pageId: "pg2", shot: true }));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("About draft");
    expect(html).not.toContain("only you can see this");
    expect(res.headers.get("content-security-policy")).toMatch(/^sandbox/);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
  it("works for the home page too", async () => {
    expect(await (await call(signed({ templateId: "root1", shot: true }))).text()).toContain("Root draft");
  });
  it("rejects a token for a different page, an expired one and a garbled one", async () => {
    const forHome = new URL(signed({ templateId: "root1", shot: true }));
    forHome.searchParams.set("page", "pg2");
    expect((await call(forHome.toString())).status).toBe(403);
    expect((await call(signed({ templateId: "root1", shot: true }, { now: Date.now() - 600_000 }))).status).toBe(403);
    const bad = new URL(signed({ templateId: "root1", shot: true }));
    bad.searchParams.set("sig", "abcd");
    expect((await call(bad.toString())).status).toBe(403);
  });
  it("a token for another site does not open this one", async () => {
    expect((await call(signed({ templateId: "other", shot: true }))).status).toBe(403);
  });
  it("without a token the sign-in and workspace rules still apply", async () => {
    db.user = { organizationId: "someone-else" };
    expect((await call("https://app.example.com/api/v1/templates/root1/draft-preview")).status).toBe(404);
    db.user = { organizationId: "org1" };
    const res = await call("https://app.example.com/api/v1/templates/root1/draft-preview");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("only you can see this");
  });
});
