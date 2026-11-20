import { describe, expect, it, vi, beforeEach } from "vitest";

// The store reads/writes DynamoDB and the owner's plan; stand those in so the gate + validation run for real.
const state = { plan: "PRO", domains: [{ type: "CUSTOM", active: true }] as Record<string, unknown>[], row: null as Record<string, unknown> | null, saved: [] as unknown[] };

vi.mock("@/lib/db/commerceEntities", () => ({ CommerceSettings: {} }));
vi.mock("@/lib/db/contentEntities", () => ({
  Template: {},
  BlogSite: {},
  PublishedDomain: { query: { primary: () => ({ go: async () => ({ data: state.domains }) }) } },
  SiteLayout: {
    get: () => ({ go: async () => ({ data: state.row }) }),
    patch: () => ({ set: (v: unknown) => ({ go: async () => void state.saved.push(v) }) }),
    create: (v: unknown) => ({ go: async () => void state.saved.push(v) }),
  },
}));
vi.mock("@/lib/db/coreEntities", () => ({ User: { get: () => ({ go: async () => ({ data: { name: "Ada" } }) }) } }));
vi.mock("@/lib/plan/workspacePlan", () => ({ workspaceOwner: async () => ({}), planFromOwner: () => ({ subscriptionPlan: state.plan }) }));

import { saveCustomCode } from "@/lib/customCode/store";
import { applyPageChrome } from "@/lib/siteLayoutCore";

const save = (head?: unknown, footer?: unknown) => saveCustomCode({ organizationId: "o", templateId: "t", userId: "u", head, footer });

beforeEach(() => {
  state.plan = "PRO";
  state.domains = [{ type: "CUSTOM", active: true }];
  state.row = null;
  state.saved = [];
});

describe("saving header/footer code (dashboard and MCP share this)", () => {
  it("saves a valid snippet and records who changed it", async () => {
    const r = await save('<meta name="google-site-verification" content="x">');
    expect(r.ok).toBe(true);
    expect(state.saved[0]).toMatchObject({ customHeadCode: '<meta name="google-site-verification" content="x">', customCodeUpdatedBy: "u" });
  });
  it("rejects disallowed tags with a plain reason and saves nothing", async () => {
    const r = await save("<div>hi</div>");
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(r.ok ? "" : r.error).toMatch(/Header code: .*can't be added/);
    expect(state.saved).toHaveLength(0);
  });
  it("lets a Starter owner with a custom domain save", async () => {
    state.plan = "STARTER";
    expect((await save("<meta name=a content=b>")).ok).toBe(true);
  });
  it("tells a Free owner to upgrade to Starter", async () => {
    state.plan = "FREE";
    const r = await save("<meta name=a content=b>");
    expect(r).toMatchObject({ ok: false, status: 403 });
    expect(r.ok ? "" : r.error).toMatch(/Starter plan/);
    expect(state.saved).toHaveLength(0);
  });
  it("tells a Pro owner without a custom domain to connect one", async () => {
    state.domains = [{ type: "SUBDOMAIN", active: true }];
    const r = await save("<meta name=a content=b>");
    expect(r.ok ? "" : r.error).toMatch(/connect one first/);
    state.domains = [{ type: "CUSTOM", active: false }];
    expect((await save("<meta name=a content=b>")).ok).toBe(false);
  });
});

describe("checkout opt-in and audit", () => {
  it("saves the checkout choice on its own and rejects anything but on/off", async () => {
    const r = await saveCustomCode({ organizationId: "o", templateId: "t", userId: "u", onCheckout: true });
    expect(r.ok).toBe(true);
    expect(state.saved[0]).toMatchObject({ customCodeOnCheckout: true, customCodeUpdatedBy: "u" });
    const bad = await saveCustomCode({ organizationId: "o", templateId: "t", userId: "u", onCheckout: "yes" });
    expect(bad).toMatchObject({ ok: false, status: 400 });
  });
  it("records who and when without logging the code itself", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await save('<meta name="google-site-verification" content="SECRET-ID">');
    const line = String(log.mock.calls[0]?.[0]);
    expect(line).toContain("custom-code-saved");
    expect(line).toContain('"userId":"u"');
    expect(line).toMatch(/"at":"\d{4}-/);
    expect(line).not.toContain("SECRET-ID");
    log.mockRestore();
    expect(state.saved[0]).toMatchObject({ customCodeUpdatedBy: "u" });
  });
  it("names the custom domain the code runs on", async () => {
    state.domains = [{ type: "CUSTOM", active: true, domain: "www.acme.com" }];
    const r = await save("<meta name=a content=b>");
    expect(r.ok && r.state.domain).toBe("www.acme.com");
    expect(r.ok && r.state.blockedFix).toBeNull();
  });
  it("hands a blocked owner the one-click fix", async () => {
    state.plan = "FREE";
    state.domains = [];
    const { readCustomCode } = await import("@/lib/customCode/store");
    const s = await readCustomCode("o", "t");
    expect(s.blockedFix).toMatchObject({ reason: "plan", href: expect.stringMatching(/^\/dashboard\//) });
    state.plan = "STARTER";
    expect((await readCustomCode("o", "t")).blockedFix).toMatchObject({ reason: "domain", label: "Connect my domain" });
  });
});

describe("per-page header/footer switches", () => {
  const layout = { headerRows: [1], footerRows: [2], headerSource: { designFormat: "v2", designJson: {} }, footerSource: { designFormat: "v2", designJson: {} } };
  it("keeps the layout untouched by default (same reference)", () => {
    expect(applyPageChrome(layout, {})).toBe(layout);
    expect(applyPageChrome(layout, null)).toBe(layout);
    expect(applyPageChrome(null, { hideHeader: true })).toBeNull();
  });
  it("drops only the part the page hides", () => {
    expect(applyPageChrome(layout, { hideHeader: true })).toMatchObject({ headerRows: [], headerSource: null, footerRows: [2] });
    expect(applyPageChrome(layout, { hideFooter: true })).toMatchObject({ footerRows: [], footerSource: null, headerRows: [1] });
  });
});
