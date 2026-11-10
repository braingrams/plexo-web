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

  it("serves a built asset requested under /__plexo/assets from the app's own files, without invoking the function", async () => {
    getObject.mockResolvedValue({ body: Buffer.from("body{}"), contentType: "text/css", etag: '"c1"' });
    const res = await serveDeployedSsr(new NextRequest("https://site.test/__plexo/assets/_next/static/chunks/a.css"), app, ["__plexo", "assets", "_next", "static", "chunks", "a.css"], { templateId: "tmpl1", dailyRequestLimit: 100 });
    expect(getObject).toHaveBeenCalledWith(`${SITE_PREFIX}/_next/static/chunks/a.css`);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/css");
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

  it("does not sign x-forwarded-for (the function URL changes it, so the signature fails); passes the client address as x-plexo-client-ip", async () => {
    getObject.mockResolvedValue(null);
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
    await serveDeployedSsr(new NextRequest("https://site.test/p", { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } }), app, ["p"], { templateId: "tmpl1" });
    const headers = (fetchMock.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers["x-forwarded-for"]).toBeUndefined();
    expect(headers["x-plexo-client-ip"]).toBe("1.2.3.4, 10.0.0.1");
    expect(headers.authorization).not.toMatch(/x-forwarded-for/);
  });

  it("does not copy Next.js's own cache headers from the app onto the response", async () => {
    getObject.mockResolvedValue(null);
    fetchMock.mockResolvedValue(new Response("<h1>Hi</h1>", { status: 200, headers: { "content-type": "text/html; charset=utf-8", "x-nextjs-cache": "HIT", "x-nextjs-prerender": "1", "x-nextjs-stale-time": "300", "x-powered-by": "Next.js" } }));
    const res = await serveDeployedSsr(new NextRequest("https://site.test/"), app, [], { templateId: "tmpl1", dailyRequestLimit: 100 });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-nextjs-cache")).toBeNull();
    expect(res.headers.get("x-nextjs-prerender")).toBeNull();
    expect(res.headers.get("x-powered-by")).toBeNull();
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("does not forward accept-encoding, so the app returns bytes that need no decoding", async () => {
    getObject.mockResolvedValue(null);
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
    await serveDeployedSsr(new NextRequest("https://site.test/p", { headers: { "accept-encoding": "gzip" } }), app, ["p"], { templateId: "tmpl1" });
    const headers = (fetchMock.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers["accept-encoding"]).toBeUndefined();
  });

  describe("next/image", () => {
    const IMAGE_URL = "https://img123.lambda-url.us-east-1.on.aws/";
    const withImage = { ...app, imageFunctionUrl: IMAGE_URL };

    it("sends /_next/image to the image function, keeping the query", async () => {
      getObject.mockResolvedValue(null);
      fetchMock.mockResolvedValue(new Response("png-bytes", { status: 200, headers: { "content-type": "image/webp" } }));
      const res = await serveDeployedSsr(new NextRequest("https://site.test/_next/image?url=%2Flogo.png&w=640&q=75"), withImage, ["_next", "image"], { templateId: "tmpl1", dailyRequestLimit: 100 });
      const [calledUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(calledUrl).toBe("https://img123.lambda-url.us-east-1.on.aws/_next/image?url=%2Flogo.png&w=640&q=75");
      expect(res.status).toBe(200);
    });

    it("counts image requests against the daily cap", async () => {
      getObject.mockResolvedValue(null);
      checkLimit.mockResolvedValue(false);
      const res = await serveDeployedSsr(new NextRequest("https://site.test/_next/image?url=%2Fa.png&w=64&q=75"), withImage, ["_next", "image"], { templateId: "tmpl1", dailyRequestLimit: 1 });
      expect(res.status).toBe(429);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("refuses writes to the optimizer without invoking it", async () => {
      getObject.mockResolvedValue(null);
      const res = await serveDeployedSsr(new NextRequest("https://site.test/_next/image?url=%2Fa.png&w=64&q=75", { method: "POST" }), withImage, ["_next", "image"], { templateId: "tmpl1" });
      expect(res.status).toBe(405);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns not-found when the app has no image function", async () => {
      getObject.mockResolvedValue(null);
      const res = await serveDeployedSsr(new NextRequest("https://site.test/_next/image?url=%2Fa.png&w=64&q=75"), { ...app, imageFunctionUrl: "" }, ["_next", "image"], { templateId: "tmpl1" });
      expect(res.status).toBe(404);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("still sends ordinary pages to the server function, not the optimizer", async () => {
      getObject.mockResolvedValue(null);
      fetchMock.mockResolvedValue(new Response("<h1>page</h1>", { status: 200 }));
      await serveDeployedSsr(new NextRequest("https://site.test/about"), withImage, ["about"], { templateId: "tmpl1" });
      expect((fetchMock.mock.calls[0] as [string])[0]).toBe("https://abc123.lambda-url.us-east-1.on.aws/about");
    });
  });
});
