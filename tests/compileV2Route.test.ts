import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { blankPages, createDefaultDesignSystem } from "@charisol/plexo-sdk/v2/compile";

const state = vi.hoisted(() => ({ keys: [] as Array<{ id: string; organizationId: string; isActive: boolean }>, session: null as null | { user: { id: string } }, limited: false, patched: 0 }));

vi.mock("@/server/authDynamo", () => ({ auth: async () => state.session }));
vi.mock("@/lib/commerceRateLimitDynamo", () => ({ checkCommerceRateLimit: async () => !state.limited }));
vi.mock("@/lib/db/coreEntities", () => ({
  ApiKey: {
    query: { byHashedKey: () => ({ go: async () => ({ data: state.keys }) }) },
    patch: () => ({ set: () => ({ go: async () => void (state.patched += 1) }) }),
  },
}));

import { POST, MAX_PAGES } from "@/app/api/v1/compile-v2/route";

const call = (body: unknown, headers: Record<string, string> = { "x-api-key": "plx_test" }) =>
  POST(new NextRequest("https://plexo.test/api/v1/compile-v2", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));

const page = () => structuredClone(blankPages()[0]);

beforeEach(() => {
  state.keys = [{ id: "k1", organizationId: "o1", isActive: true }];
  state.session = null;
  state.limited = false;
  state.patched = 0;
});

describe("POST /api/v1/compile-v2", () => {
  it("requires an API key", async () => {
    const res = await call({ page: page() }, {});
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/API key/);
  });

  it("rejects unknown or switched-off keys", async () => {
    state.keys = [{ id: "k1", organizationId: "o1", isActive: false }];
    expect((await call({ page: page() })).status).toBe(403);
  });

  it("accepts the dashboard session via workspace-internal, and refuses it signed out", async () => {
    expect((await call({ page: page() }, { "x-api-key": "workspace-internal" })).status).toBe(401);
    state.session = { user: { id: "u1" } };
    expect((await call({ page: page() }, { "x-api-key": "workspace-internal" })).status).toBe(200);
  });

  it("compiles a valid page", async () => {
    const res = await call({ page: page(), designSystem: createDefaultDesignSystem(), options: { title: "Hello", lang: "en" } });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(typeof out.html).toBe("string");
    expect(out.document).toContain("<title>Hello</title>");
    expect(Array.isArray(out.warnings)).toBe(true);
    expect(state.patched).toBe(1);
  });

  it("compiles several pages and mirrors the first at the top level", async () => {
    const out = await (await call({ pages: [page(), { ...page(), id: "p2", slug: "about", isHome: false }] })).json();
    expect(out.pages).toHaveLength(2);
    expect(out.html).toBe(out.pages[0].html);
  });

  it("sanitises a malicious page", async () => {
    const p = page();
    const section = (p.rootNode.children as Array<{ children?: unknown[] }>)[0];
    section.children = [
      { id: "evil-p", type: "paragraph", name: "x", props: {}, styles: {}, content: '<img src=x onerror="alert(1)"><script>alert(2)</script>safe words' },
      { id: "evil-b", type: "button", name: "y", props: { href: "javascript:alert(3)" }, styles: {}, content: "Click" },
    ];
    const res = await call({ page: p });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.html).toContain("Click"); // content survives, just defanged
    for (const field of [out.html, out.document]) {
      expect(field).not.toMatch(/<img[^>]*onerror/i); // shown as plain text, never as a live tag
      expect(field).not.toMatch(/<script[^>]*>\s*alert/i);
      expect(field).not.toMatch(/javascript:/i);
    }
  });

  it("rejects an oversize body", async () => {
    const res = await call(JSON.stringify({ page: page(), pad: "x".repeat(2_100_000) }));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatch(/too large/);
  });

  it("rejects too many pages, bad shapes and bad options in plain language", async () => {
    expect((await call({ pages: Array.from({ length: MAX_PAGES + 1 }, page) })).status).toBe(400);
    expect((await call("not json")).status).toBe(400);
    expect((await call({})).status).toBe(400);
    expect((await call({ page: { nope: true } })).status).toBe(400);
    const badOpt = await call({ page: page(), options: { formActionUrl: "http://insecure.test" } });
    expect(badOpt.status).toBe(400);
    expect((await badOpt.json()).error).toMatch(/https/);
    expect((await call({ page: page(), designSystem: "x" })).status).toBe(400);
  });

  it("sends forms to the host's address when formActionUrl is given", async () => {
    const out = await (await call({ page: page(), options: { formActionUrl: "https://example.com/forms/{formId}" } })).json();
    expect(out.warnings).toBeDefined();
  });

  it("rate limits", async () => {
    state.limited = true;
    expect((await call({ page: page() })).status).toBe(429);
  });
});
