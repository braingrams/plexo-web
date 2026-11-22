import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ── What would be sent to CloudFront, and who may start the scheduled jobs ────────────────────────────────────────────────────
// Neither can be tried against the real services from here, so the requests and the checks around them are pinned down exactly.

const h = vi.hoisted(() => ({
  sent: [] as { kind: string; input: any }[],
  domains: [] as Record<string, any>[],
  limits: new Map<string, boolean>(),
  pages: [] as { loc: string }[],
  lockTaken: true,
  admin: false,
  ran: [] as string[],
}));

vi.mock("@aws-sdk/client-cloudfront", () => {
  class CreateInvalidationCommand { kind = "distribution"; constructor(public input: any) {} }
  class CreateInvalidationForDistributionTenantCommand { kind = "tenant"; constructor(public input: any) {} }
  class CloudFrontClient { async send(cmd: { kind: string; input: any }) { h.sent.push({ kind: cmd.kind, input: cmd.input }); return {}; } }
  return { CloudFrontClient, CreateInvalidationCommand, CreateInvalidationForDistributionTenantCommand };
});
vi.mock("@/lib/db/contentEntities", () => ({
  PublishedDomain: { query: { primary: () => ({ go: async () => ({ data: h.domains }) }) } },
  Template: { get: () => ({ go: async () => ({ data: { id: "site1" } }) }) },
}));
vi.mock("@/lib/commerceRateLimitDynamo", () => ({ checkCommerceRateLimit: async (key: string) => h.limits.get(key) ?? true }));
vi.mock("@/lib/pub/siteSitemap", () => ({ listSitePages: async () => h.pages }));
vi.mock("@/server/adminAuth", () => ({ isAuthorizedAdmin: () => h.admin }));
vi.mock("@/lib/siteHealth/recheck", () => ({
  takeJobLock: async (name: string) => h.lockTaken && (h.ran.push(`lock:${name}`), true),
  processRecheckQueue: async () => (h.ran.push("recheck"), { ran: 1 }),
  sweepWeekly: async () => (h.ran.push("sweep"), { queued: 1 }),
}));
vi.mock("@/lib/siteHealth/digest", () => ({ sendWeeklyDigests: async () => (h.ran.push("digest"), { sent: 1 }) }));

import { pathsToClear, purgeSitePages } from "@/lib/pub/edgeCache";

beforeEach(() => {
  h.sent.length = 0;
  h.domains = [];
  h.limits.clear();
  h.pages = [];
  h.lockTaken = true;
  h.admin = false;
  h.ran.length = 0;
  process.env.PLEXO_PUBLISHED_SITES_DISTRIBUTION_ID = "E123ABC";
});

describe("CloudFront clearing requests", () => {
  it("does nothing, quietly, when no distribution is configured", async () => {
    delete process.env.PLEXO_PUBLISHED_SITES_DISTRIBUTION_ID;
    expect(await purgeSitePages("site1")).toEqual({ cleared: 0, skipped: "no distribution configured" });
    expect(h.sent).toEqual([]);
  });

  it("clears a plexopages address by the exact paths of its pages, on the named distribution", async () => {
    h.domains = [{ id: "d1", type: "SUBDOMAIN", domain: "mama.plexopages.io", active: true }];
    h.pages = [{ loc: "https://mama.plexopages.io/" }, { loc: "https://mama.plexopages.io/about" }, { loc: "https://other.plexopages.io/x" }];
    expect(await purgeSitePages("site1")).toEqual({ cleared: 1 });
    expect(h.sent).toHaveLength(1);
    const { kind, input } = h.sent[0];
    expect(kind).toBe("distribution");
    expect(input.DistributionId).toBe("E123ABC");
    expect(input.InvalidationBatch.CallerReference).toMatch(/^site1-\d+-d$/);
    expect(input.InvalidationBatch.Paths.Items.sort()).toEqual(["/", "/about", "/about/"].sort());
    expect(input.InvalidationBatch.Paths.Quantity).toBe(input.InvalidationBatch.Paths.Items.length);
    expect(input.InvalidationBatch.Paths.Items).not.toContain("/x");
  });

  it("clears a custom domain with one wildcard on its own tenant, never on the shared distribution", async () => {
    h.domains = [{ id: "d9", type: "CUSTOM", domain: "mamatee.com", tenantId: "dt_123", active: true }];
    await purgeSitePages("site1");
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].kind).toBe("tenant");
    expect(h.sent[0].input.Id).toBe("dt_123");
    expect(h.sent[0].input.InvalidationBatch.Paths).toEqual({ Quantity: 1, Items: ["/*"] });
    expect(h.sent[0].input.InvalidationBatch.CallerReference).toMatch(/^site1-\d+-d9$/);
  });

  it("uses a single wildcard when a site has more pages than the cap, so the bill stays bounded", () => {
    const pages = Array.from({ length: 40 }, (_, i) => ({ loc: `https://a.plexopages.io/p${i}` }));
    expect(pathsToClear(pages, "a.plexopages.io")).toEqual(["/*"]);
  });

  it("respects the per-site and daily limits and skips sites that are not live", async () => {
    h.domains = [{ id: "d1", type: "SUBDOMAIN", domain: "a.plexopages.io", active: true }];
    h.limits.set("purge:site:site1", false);
    expect(await purgeSitePages("site1")).toMatchObject({ cleared: 0, skipped: "cleared a moment ago" });
    h.limits.clear();
    h.limits.set("purge:global", false);
    expect(await purgeSitePages("site1")).toMatchObject({ cleared: 0, skipped: "daily limit reached" });
    h.limits.clear();
    h.domains = [{ id: "d1", type: "SUBDOMAIN", domain: "a.plexopages.io", active: false }];
    expect(await purgeSitePages("site1")).toMatchObject({ cleared: 0, skipped: "not live" });
    expect(h.sent).toEqual([]);
  });
});

const call = (mod: { GET: (r: NextRequest) => Promise<Response> }, headers: Record<string, string> = {}) => mod.GET(new NextRequest("https://app.test/api/internal/x", { headers }));

describe.each([
  ["recheck", () => import("@/app/api/internal/site-health/recheck/route"), "recheck"],
  ["sweep", () => import("@/app/api/internal/site-health/sweep/route"), "sweep"],
  ["digest", () => import("@/app/api/internal/site-health/digest/route"), "digest"],
])("scheduled route: %s", (name, load, work) => {
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret-value";
  });

  it("refuses anyone without the scheduler's secret or the admin token, and runs nothing", async () => {
    const mod = await load();
    expect((await call(mod)).status).toBe(401);
    expect((await call(mod, { "x-cron-secret": "wrong-secret!" })).status).toBe(401);
    expect(h.ran).toEqual([]);
  });

  it("runs for the scheduler's secret, and takes the lock first", async () => {
    const mod = await load();
    const res = await call(mod, { "x-cron-secret": "s3cret-value" });
    expect(res.status).toBe(200);
    expect(h.ran).toEqual([`lock:${name}`, work]);
  });

  it("runs for an admin by hand", async () => {
    h.admin = true;
    expect((await call(await load())).status).toBe(200);
    expect(h.ran).toContain(work);
  });

  it("does not start a second run while the first holds the lock (EventBridge retries slow calls)", async () => {
    h.lockTaken = false;
    const res = await call(await load(), { "x-cron-secret": "s3cret-value" });
    expect(await res.json()).toHaveProperty("skipped");
    expect(h.ran).toEqual([]);
  });
});
