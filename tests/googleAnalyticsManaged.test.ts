import { generateKeyPairSync, createVerify } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANALYTICS_UPGRADE_MESSAGE, canUseGoogleAnalytics } from "@/lib/googleAnalytics/access";
import { buildServiceAssertion, createManagedProperty, isCapacityError, isManagedConfigured, managedAccounts, ManagedUnavailableError } from "@/lib/googleAnalytics/managed";
import { GoogleApiError } from "@/lib/googleAnalytics/dataClient";
import { lapseStep } from "@/lib/googleAnalytics/lapse";
import { consentRequiredFor, visitorCountry } from "@/lib/consent/regions";
import { DEFAULT_CONSENT } from "@/lib/consent/model";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("plan gating", () => {
  it("is a paid-plan feature", () => {
    expect(canUseGoogleAnalytics("FREE")).toBe(false);
    expect(canUseGoogleAnalytics(null)).toBe(false);
    expect(canUseGoogleAnalytics("STARTER")).toBe(true);
    expect(canUseGoogleAnalytics("PRO")).toBe(true);
    expect(canUseGoogleAnalytics("ENTERPRISE")).toBe(true);
    expect(canUseGoogleAnalytics("ULTRA")).toBe(true); // the old name for Pro
  });
  it("says what to do in plain words", () => {
    expect(ANALYTICS_UPGRADE_MESSAGE).toMatch(/Starter/);
    expect(ANALYTICS_UPGRADE_MESSAGE).not.toMatch(/GA4|OAuth|API/);
  });
});

describe("Plexo's Google service account", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_ANALYTICS_MANAGED_SERVICE_ACCOUNT", JSON.stringify({ client_email: "plexo@proj.iam.gserviceaccount.com", private_key: pem }));
    vi.stubEnv("GOOGLE_ANALYTICS_MANAGED_ACCOUNTS", "accounts/111, 222");
    vi.stubEnv("NODE_ENV", "production");
  });
  it("reads its settings, accepting plain or base64 keys and ids with or without 'accounts/'", () => {
    expect(isManagedConfigured()).toBe(true);
    expect(managedAccounts()).toEqual(["accounts/111", "accounts/222"]);
    vi.stubEnv("GOOGLE_ANALYTICS_MANAGED_SERVICE_ACCOUNT", Buffer.from(JSON.stringify({ client_email: "a@b", private_key: pem })).toString("base64"));
    expect(isManagedConfigured()).toBe(true);
    vi.stubEnv("GOOGLE_ANALYTICS_MANAGED_ACCOUNTS", "not-an-id");
    expect(isManagedConfigured()).toBe(false);
  });
  it("signs a request Google can verify", () => {
    const jwt = buildServiceAssertion({ client_email: "plexo@proj.iam.gserviceaccount.com", private_key: pem }, 1_700_000_000_000);
    const [h, c, s] = jwt.split(".");
    expect(createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(s, "base64url"))).toBe(true);
    const claims = JSON.parse(Buffer.from(c, "base64url").toString());
    expect(claims.iss).toBe("plexo@proj.iam.gserviceaccount.com");
    expect(claims.scope).toContain("analytics.edit");
    expect(claims.exp - claims.iat).toBe(3600);
  });
  it("tells a full account from a real failure", () => {
    expect(isCapacityError(new GoogleApiError(429, "quota"))).toBe(true);
    expect(isCapacityError(new GoogleApiError(400, "Google Analytics answered 400: reached the limit of properties"))).toBe(true);
    expect(isCapacityError(new GoogleApiError(400, "Google Analytics answered 400: bad name"))).toBe(false);
    expect(isCapacityError(new GoogleApiError(403, "forbidden"))).toBe(false);
  });

  function fakeGoogle(handler: (url: string, body: any) => { status: number; json: unknown }) {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { body?: string }) => {
      calls.push(url);
      if (url.includes("oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
      const r = handler(url, init?.body ? JSON.parse(init.body) : undefined);
      return new Response(JSON.stringify(r.json), { status: r.status });
    }));
    return calls;
  }

  it("moves to the next Plexo account when one is full (sharding), and records which one holds the property", async () => {
    fakeGoogle((url, body) => {
      if (url.endsWith("/properties")) {
        return body.parent === "accounts/111"
          ? { status: 400, json: { error: { message: "You have reached the maximum number of properties" } } }
          : { status: 200, json: { name: "properties/900", displayName: body.displayName } };
      }
      if (url.endsWith("/properties/900/dataStreams?pageSize=200")) return { status: 200, json: {} };
      if (url.endsWith("/properties/900/dataStreams")) return { status: 200, json: { name: "properties/900/dataStreams/5", webStreamData: { measurementId: "G-PLEXO0001" } } };
      return { status: 404, json: {} };
    });
    const made = await createManagedProperty("https://shop.example.com");
    expect(made.accountName).toBe("accounts/222");
    expect(made.measurementId).toBe("G-PLEXO0001");
    expect(made.propertyDisplayName).toBe("shop.example.com (Plexo)");
  });
  it("never sends the owner's identity to Google", async () => {
    const seen: string[] = [];
    fakeGoogle((url, body) => {
      seen.push(JSON.stringify(body ?? {}));
      if (url.endsWith("/properties")) return { status: 200, json: { name: "properties/7" } };
      if (url.includes("dataStreams?")) return { status: 200, json: {} };
      return { status: 200, json: { name: "properties/7/dataStreams/1", webStreamData: { measurementId: "G-PLEXO0002" } } };
    });
    await createManagedProperty("https://me.example.org");
    expect(seen.join(" ")).not.toMatch(/@/);
  });
  it("reports 'full' when every account is full, so the owner keeps the basic counts", async () => {
    fakeGoogle(() => ({ status: 429, json: { error: { message: "quota" } } }));
    await expect(createManagedProperty("https://x.example.com")).rejects.toMatchObject({ reason: "full" });
  });
  it("is not-configured without accounts", async () => {
    vi.stubEnv("GOOGLE_ANALYTICS_MANAGED_ACCOUNTS", "");
    await expect(createManagedProperty("https://x.example.com", [])).rejects.toBeInstanceOf(ManagedUnavailableError);
  });
});

describe("retention when a plan ends", () => {
  const now = new Date("2026-11-19T00:00:00Z");
  it("marks, waits 90 days, then cleans up; paying again restores", () => {
    expect(lapseStep({}, true, now)).toBe("none");
    expect(lapseStep({}, false, now)).toBe("set_mark");
    expect(lapseStep({ lapsedAt: "2026-10-01T00:00:00Z" }, false, now)).toBe("none");
    expect(lapseStep({ lapsedAt: "2026-08-01T00:00:00Z" }, false, now)).toBe("delete");
    expect(lapseStep({ lapsedAt: "2026-10-01T00:00:00Z" }, true, now)).toBe("clear_mark");
  });
});

describe("tenant isolation and fallbacks (routes and tag)", () => {
  async function load(plan: string, conn: Record<string, unknown> | null) {
    vi.resetModules();
    const startManaged = vi.fn(async () => ({ status: "done", measurementId: "G-X" }));
    const disconnect = vi.fn(async () => undefined);
    const reportForSite = vi.fn(async () => { throw new Error("should not be called"); });
    vi.doMock("@/lib/sites/authorizeSite", () => ({ authorizeSite: async () => ({ site: { id: "site1", organizationId: "org1" }, user: { userId: "u1", subscriptionPlan: plan } }) }));
    vi.doMock("@/lib/googleAnalytics/connection", () => ({
      getConnection: async () => conn, startManaged, disconnect, reportForSite, siteUrlFor: async () => "https://x.example.com",
      accessTokenFor: async () => "t", adminClientFor: () => ({ listProperties: async () => [] }), markNeedsReconnect: async () => undefined, provisionSite: async () => ({ status: "done" }), GoogleApiError,
    }));
    vi.doMock("@/lib/db/opsEntities", () => ({ SiteGoogleAnalytics: {} }));
    const route = await import("@/app/api/v1/sites/[id]/google-analytics/route");
    const req = (method: string, body?: unknown) => new Request("http://x/api", { method, body: body ? JSON.stringify(body) : undefined }) as never;
    return { route, req, startManaged, disconnect, reportForSite };
  }
  const ctx = { params: Promise.resolve({ id: "site1" }) };

  it("Free plan: shows the upgrade card and does nothing on the server", async () => {
    const t = await load("FREE", null);
    const get = await t.route.GET(t.req("GET"), ctx);
    expect((await get.json()).state).toBe("upgrade");
    const post = await t.route.POST(t.req("POST", { action: "use_plexo" }), ctx);
    expect(post.status).toBe(402);
    expect((await post.json()).error).toMatch(/Starter/);
    expect(t.startManaged).not.toHaveBeenCalled();
    const bad = await t.route.POST(t.req("POST", { action: "hand_over", email: "a@b.co" }), ctx);
    expect(bad.status).toBe(402);
  });
  it("Free plan can still turn analytics off", async () => {
    const t = await load("FREE", null);
    expect((await t.route.POST(t.req("POST", { action: "disconnect" }), ctx)).status).toBe(200);
    expect(t.disconnect).toHaveBeenCalledWith("site1");
  });
  it("Starter plan can switch on Plexo's own analytics", async () => {
    const t = await load("STARTER", null);
    const post = await t.route.POST(t.req("POST", { action: "use_plexo" }), ctx);
    expect((await post.json()).outcome).toBe("done");
    expect(t.startManaged).toHaveBeenCalledWith({ id: "site1", organizationId: "org1" }, "u1");
  });
  it("a site is only read through its own stored property: a body can't name another one", async () => {
    const t = await load("PRO", { templateId: "site1", mode: "managed", measurementId: "G-X", propertyName: "properties/1", connectedAt: new Date().toISOString(), status: "connected" });
    t.reportForSite.mockResolvedValueOnce({ rangeDays: 28, totals: { visitors: 0, visits: 0, pageViews: 0, avgSeconds: 0, engagedShare: 0 }, previous: { visitors: 0, visits: 0, pageViews: 0, avgSeconds: 0, engagedShare: 0 }, daily: [], topPages: [], sources: [], countries: [], devices: [] } as never);
    const res = await t.route.GET(new Request("http://x/api?days=28&propertyName=properties/999&property=properties/999") as never, ctx);
    const json = await res.json();
    expect(json.state).toBe("ready");
    expect(t.reportForSite).toHaveBeenCalledTimes(1);
    const args = (t.reportForSite.mock.calls[0] as unknown) as unknown[];
    expect((args[0] as { propertyName: string }).propertyName).toBe("properties/1");
    expect(args[1]).toBe("site1");
    expect(json.justConnected).toBe(true); // brand-new and empty: "data usually appears in a few hours"
  });
  it("own-account steps are refused on a Plexo-managed site", async () => {
    const t = await load("PRO", { templateId: "site1", mode: "managed", measurementId: "G-X", propertyName: "properties/1", status: "connected" });
    const res = await t.route.POST(t.req("POST", { action: "choose", propertyName: "properties/2", accountName: "accounts/2" }), ctx);
    expect(res.status).toBe(409);
  });
  it("hand-over asks for a real email first", async () => {
    const t = await load("PRO", { templateId: "site1", mode: "managed", measurementId: "G-X", propertyName: "properties/1", status: "connected" });
    const res = await t.route.POST(t.req("POST", { action: "hand_over", email: "nope" }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/email/);
  });
  it("falls back to the basic counts when Google isn't set up at all", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GOOGLE_ANALYTICS_MOCK", "");
    vi.stubEnv("GOOGLE_ANALYTICS_MANAGED_SERVICE_ACCOUNT", "");
    vi.stubEnv("GOOGLE_ANALYTICS_MANAGED_ACCOUNTS", "");
    vi.stubEnv("GOOGLE_ANALYTICS_CLIENT_ID", "");
    const t = await load("PRO", null);
    expect((await (await t.route.GET(t.req("GET"), ctx)).json()).state).toBe("unavailable");
  });
});

describe("tag at serve time", () => {
  async function serve(tag: unknown, html: string, headers: Record<string, string>) {
    vi.resetModules();
    vi.doMock("@/lib/googleAnalytics/connection", () => ({ tagForSite: async () => tag }));
    const { applyAnalyticsTag } = await import("@/lib/googleAnalytics/serveTag");
    return applyAnalyticsTag(html, "site1", new Headers(headers));
  }
  const tag = { measurementId: "G-ABC1234", consent: DEFAULT_CONSENT };
  const page = "<html><head></head><body>hi</body></html>";
  it("adds nothing when the site has no tag (not connected, or plan ended)", async () => {
    expect(await serve(null, page, {})).toBe(page);
  });
  it("European visitors get the ask-first version, others the plain one", async () => {
    expect(await serve(tag, page, { "cloudfront-viewer-country": "FR" })).toContain('"ask":true');
    expect(await serve(tag, page, { "cloudfront-viewer-country": "NG" })).toContain('"ask":false');
    expect(await serve(tag, page, {})).toContain('"ask":true');
  });
  it("is the same function for every kind of page (raw HTML has no head; apps have one)", async () => {
    expect(await serve(tag, "<h1>raw</h1>", { "cloudfront-viewer-country": "NG" })).toMatch(/^<script data-plexo-analytics>/);
  });
  it("never breaks the page if the lookup fails", async () => {
    vi.resetModules();
    vi.doMock("@/lib/googleAnalytics/connection", () => ({ tagForSite: async () => { throw new Error("db down"); } }));
    const { applyAnalyticsTag } = await import("@/lib/googleAnalytics/serveTag");
    expect(await applyAnalyticsTag(page, "s", new Headers())).toBe(page);
  });
  it("region helpers agree", () => {
    expect(consentRequiredFor(visitorCountry(new Headers({ "cloudfront-viewer-country": "GB" })))).toBe(true);
  });
});

describe("MCP tools", () => {
  it("give a plain upgrade message on the Free plan and never touch Google", async () => {
    vi.resetModules();
    const startManaged = vi.fn();
    vi.doMock("@/lib/db/contentEntities", () => ({ Template: { get: () => ({ go: async () => ({ data: { id: "s1", organizationId: "o1" } }) }) } }));
    vi.doMock("@/lib/db/opsEntities", () => ({ SiteGoogleAnalytics: {} }));
    vi.doMock("@/lib/googleAnalytics/connection", () => ({ startManaged, disconnect: vi.fn(), forgetTag: vi.fn(), getConnection: async () => null, reportForSite: vi.fn(), siteUrlFor: async () => "https://x.example.com" }));
    vi.doMock("@/lib/consent/settings", () => ({ loadConsentSettings: async () => DEFAULT_CONSENT, saveConsentSettings: vi.fn(), normalizeConsentInput: vi.fn() }));
    const { handleAnalyticsTool } = await import("@/lib/mcp/analyticsTools");
    const free = { organizationId: "o1", userId: "u", subscriptionPlan: "FREE" } as never;
    await expect(handleAnalyticsTool("turn_on_visitor_numbers", { templateId: "s1" }, free)).rejects.toThrow(/Starter/);
    await expect(handleAnalyticsTool("get_site_visits", { templateId: "s1" }, free)).rejects.toThrow(/Starter/);
    expect(startManaged).not.toHaveBeenCalled();
    const other = { organizationId: "someone-else", userId: "u", subscriptionPlan: "PRO" } as never;
    await expect(handleAnalyticsTool("get_site_visits", { templateId: "s1" }, other)).rejects.toThrow(/No site found/);
  });
});
