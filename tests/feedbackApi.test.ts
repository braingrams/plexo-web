import { beforeEach, describe, expect, it, vi } from "vitest";

const created: Record<string, unknown>[] = [];
const rate = vi.fn(async () => true);
const upload = vi.fn(async () => ({ url: "https://b.s3.amazonaws.com/private/feedback/x.png" }));
vi.mock("@/lib/auth/resolveUser", () => ({ resolveUser: vi.fn(async (r: Request) => (r.headers.get("x-auth") ? { userId: "u1" } : null)) }));
vi.mock("@/lib/db/coreEntities", () => ({ User: { get: () => ({ go: async () => ({ data: { email: "a@b.co", name: "Ada" } }) }) } }));
vi.mock("@/lib/db/contentEntities", () => ({ Feedback: { create: (v: Record<string, unknown>) => ({ go: async () => { created.push(v); } }) } }));
vi.mock("@/lib/email", () => ({ sendFeedbackNotificationEmail: vi.fn(async () => {}) }));
vi.mock("@/lib/commerceRateLimitDynamo", () => ({ checkCommerceRateLimit: (...a: unknown[]) => rate(...(a as [])) }));
vi.mock("@/lib/storage", () => ({ uploadObject: (...a: unknown[]) => upload(...(a as [])) }));

import { POST } from "@/app/api/v1/feedback/route";
import { MAX_MESSAGE, parseFeedbackBody } from "@/lib/struggle/validate";

const call = (body: unknown, auth = true) =>
  POST(new Request("http://x/api/v1/feedback", { method: "POST", headers: auth ? { "x-auth": "1" } : {}, body: JSON.stringify(body) }) as never);

beforeEach(() => { created.length = 0; rate.mockResolvedValue(true); upload.mockClear(); });

describe("POST /api/v1/feedback", () => {
  it("requires sign-in", async () => expect((await call({ message: "hi" }, false)).status).toBe(401));
  it("rejects empty and oversized messages in plain words", async () => {
    const r = await call({ message: "  " });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/tell us/i);
    expect((await call({ message: "x".repeat(MAX_MESSAGE + 1) })).status).toBe(400);
  });
  it("rate limits", async () => {
    rate.mockResolvedValue(false);
    const r = await call({ message: "hi" });
    expect(r.status).toBe(429);
    expect(created).toHaveLength(0);
  });
  it("stores a struggle report with whitelisted context only", async () => {
    const r = await call({ message: "stuck", type: "struggle", category: "broke", signals: ["rage_click", "bogus"], pageUrl: "/dashboard/pages?token=secret#x", browser: "Chrome 140", extra: "no" });
    expect(r.status).toBe(200);
    expect(created[0]).toMatchObject({ type: "struggle", category: "broke", signals: "rage_click", pageUrl: "/dashboard/pages", browser: "Chrome 140", userId: "u1" });
    expect(created[0]).not.toHaveProperty("extra");
  });
  it("uploads a valid screenshot privately; rejects bad or huge ones", async () => {
    const png = "data:image/png;base64," + Buffer.from("png-bytes").toString("base64");
    const ok = await call({ message: "see", screenshot: png });
    expect(ok.status).toBe(200);
    expect(upload).toHaveBeenCalledWith(expect.stringMatching(/^feedback\/u1\/.+\.png$/), expect.any(Buffer), expect.objectContaining({ access: "private" }));
    expect(created[0].screenshotUrl).toContain("private/feedback");
    expect((await call({ message: "x", screenshot: "data:text/html;base64,AAAA" })).status).toBe(400);
    const big = "data:image/png;base64," + Buffer.alloc(1_600_000).toString("base64");
    expect((await call({ message: "x", screenshot: big })).status).toBe(400);
  });
  it("still saves the message when the screenshot upload fails", async () => {
    upload.mockRejectedValueOnce(new Error("s3 down"));
    const r = await call({ message: "see", screenshot: "data:image/png;base64,AAAA" });
    expect(r.status).toBe(200);
    expect(created[0].screenshotUrl).toBeUndefined();
  });
  it("defaults to plain feedback", () => {
    const p = parseFeedbackBody({ message: "hello" });
    expect(p.ok && p.value.type).toBe("feedback");
  });
});
