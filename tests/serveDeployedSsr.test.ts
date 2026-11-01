import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const getObject = vi.fn();
const checkLimit = vi.fn();
vi.mock("@/lib/projects/blobStore", () => ({ getObject: (...args: unknown[]) => getObject(...args) }));
vi.mock("@/lib/pub/deployedAppRateLimit", () => ({ checkDeployedAppDailyLimit: (...args: unknown[]) => checkLimit(...args) }));

import { serveDeployedSsr } from "@/lib/pub/serveDeployedSsr";

const FUNCTION_URL = "https://abc123.lambda-url.us-east-1.on.aws/";
const SITE_PREFIX = "private/projects/tmpl1/builds/b1/site";
const app = { functionUrl: FUNCTION_URL, ssrSitePrefix: SITE_PREFIX, hostingTier: "LAMBDA" };

describe("serveDeployedSsr", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    process.env.AWS_ACCESS_KEY_ID = "AKIATESTONLY";
    process.env.AWS_SECRET_ACCESS_KEY = "testsecretonly";
    delete process.env.FUNCTIONS_ACCOUNT_ROLE_ARN;
    getObject.mockReset();
    checkLimit.mockReset().mockResolvedValue(true);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("serves a static asset from S3 without invoking the function", async () => {
    getObject.mockResolvedValue({ body: Buffer.from("console.log(1)"), contentType: "text/javascript", etag: '"e1"' });
    const res = await serveDeployedSsr(new NextRequest("https://site.test/assets/app.js"), app, ["assets", "app.js"], { templateId: "tmpl1", dailyRequestLimit: 100 });
    expect(getObject).toHaveBeenCalledWith(`${SITE_PREFIX}/assets/app.js`);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(checkLimit).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("console.log(1)");
    expect(res.headers.get("content-type")).toBe("text/javascript");
  });

  it("proxies a page to the function URL with a SigV4 signature", async () => {
    getObject.mockResolvedValue(null);
    fetchMock.mockResolvedValue(new Response("<h1>Hi</h1>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }));
    const res = await serveDeployedSsr(new NextRequest("https://site.test/about?x=1", { headers: { cookie: "sid=abc", host: "site.test" } }), app, ["about"], { templateId: "tmpl1", dailyRequestLimit: 100 });

    expect(checkLimit).toHaveBeenCalledWith("tmpl1", 100);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe("https://abc123.lambda-url.us-east-1.on.aws/about?x=1");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIATESTONLY\/\d{8}\/us-east-1\/lambda\/aws4_request/);
    expect(headers.cookie).toBe("sid=abc");
    expect(headers["x-forwarded-host"]).toBe("site.test");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<h1>Hi</h1>");
  });

  it("answers 429 when the owner's daily cap is reached, without invoking the function", async () => {
    getObject.mockResolvedValue(null);
    checkLimit.mockResolvedValue(false);
    const res = await serveDeployedSsr(new NextRequest("https://site.test/"), app, [], { templateId: "tmpl1", dailyRequestLimit: 1 });
    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns not-found when there is no function and no static file", async () => {
    getObject.mockResolvedValue(null);
    const res = await serveDeployedSsr(new NextRequest("https://site.test/x"), { ...app, functionUrl: null }, ["x"], { templateId: "tmpl1" });
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not forward accept-encoding, so the app returns bytes that need no decoding", async () => {
    getObject.mockResolvedValue(null);
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
    await serveDeployedSsr(new NextRequest("https://site.test/p", { headers: { "accept-encoding": "gzip" } }), app, ["p"], { templateId: "tmpl1" });
    const headers = (fetchMock.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers["accept-encoding"]).toBeUndefined();
  });
});
