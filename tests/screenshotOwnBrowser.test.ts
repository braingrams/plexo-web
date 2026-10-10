import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Plexo's own browser (a Lambda running Chromium) is used first; Browserbase only when it
// fails — so a busy or missing outside service no longer means "no screenshot".

const calls = vi.hoisted(() => ({ lambda: [] as unknown[], s3: [] as unknown[], lambdaAnswer: null as null | { FunctionError?: string; body: unknown } }));

vi.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: class {
    send = vi.fn(async (cmd: { input: { Payload: Uint8Array } }) => {
      calls.lambda.push(JSON.parse(Buffer.from(cmd.input.Payload).toString("utf8")));
      const a = calls.lambdaAnswer!;
      return { FunctionError: a.FunctionError, Payload: Buffer.from(JSON.stringify(a.body)) };
    });
  },
  InvokeCommand: class {
    constructor(public input: unknown) {}
  },
}));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    send = vi.fn(async (cmd: { input: unknown }) => void calls.s3.push(cmd.input));
  },
  PutObjectCommand: class {
    constructor(public input: unknown) {}
  },
}));
// Browserbase's browser: the shared page check returns a recognisable result.
vi.mock("playwright-core", () => ({
  chromium: { connectOverCDP: vi.fn(async () => ({ contexts: () => [{ pages: () => [{}] }], close: async () => {} })) },
}));
vi.mock("@/lib/projects/pageCheck", async (orig) => ({
  ...(await orig<typeof import("@/lib/projects/pageCheck")>()),
  checkPage: vi.fn(async () => ({ image: Buffer.from("from-browserbase"), title: "BB", url: "https://x", consoleErrors: [], failedRequests: [], status: 200 })),
}));

import { screenshotPage } from "@/lib/projects/screenshot";

const ownBrowserShot = { image: Buffer.from("from-own-browser").toString("base64"), title: "telly", url: "https://preview--x.plexopages.com/", consoleErrors: ["Uncaught: boom"], failedRequests: [], status: 200 };

beforeEach(() => {
  calls.lambda.length = 0;
  calls.s3.length = 0;
  process.env.USER_CONTENT_BUCKET_NAME = "bucket";
  process.env.SCREENSHOT_FUNCTION_NAME = "plexo-browser";
  process.env.BROWSERBASE_API_KEY = "bb-key";
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "s1", connectUrl: "wss://bb" }), { status: 200 })));
});
afterEach(() => vi.unstubAllGlobals());

describe("taking a screenshot of an app", () => {
  it("uses Plexo's own browser and stores what it returns", async () => {
    calls.lambdaAnswer = { body: ownBrowserShot };
    const out = await screenshotPage("https://preview--x.plexopages.com/", { userId: "u1", viewport: "mobile" });
    expect(calls.lambda).toEqual([{ url: "https://preview--x.plexopages.com/", viewport: "mobile" }]);
    expect(out).toMatchObject({ title: "telly", consoleErrors: ["Uncaught: boom"], status: 200 });
    expect(String((calls.s3[0] as { Body: Buffer }).Body)).toBe("from-own-browser");
    expect(fetch).not.toHaveBeenCalled(); // Browserbase untouched
  });

  it("falls back to Browserbase when Plexo's browser fails", async () => {
    calls.lambdaAnswer = { FunctionError: "Unhandled", body: { errorMessage: "Chromium crashed" } };
    const out = await screenshotPage("https://preview--x.plexopages.com/", { userId: "u1" });
    expect(out.title).toBe("BB");
    expect(String((calls.s3[0] as { Body: Buffer }).Body)).toBe("from-browserbase");
  });

  it("uses Browserbase where there's no browser function (local dev)", async () => {
    delete process.env.SCREENSHOT_FUNCTION_NAME;
    const out = await screenshotPage("https://preview--x.plexopages.com/", { userId: "u1" });
    expect(calls.lambda).toEqual([]);
    expect(out.title).toBe("BB");
  });
});
