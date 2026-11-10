import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dispatched = vi.hoisted(() => [] as unknown[]);
vi.mock("next/server", () => ({
  after: (fn: () => void) => fn(),
  NextResponse: { json: (body: unknown, init?: { status?: number }) => new Response(JSON.stringify(body), { status: init?.status ?? 200 }) },
}));
vi.mock("@/lib/whatsapp/dispatch", () => ({ dispatchInbound: async (m: unknown) => void dispatched.push(m) }));

import { GET, POST } from "@/app/api/webhooks/whatsapp/route";

const ENV = { WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "1", WHATSAPP_APP_SECRET: "appsecret", WHATSAPP_VERIFY_TOKEN: "verify-me", WHATSAPP_BUSINESS_NUMBER: "+234 801 000 0000" };
const req = (url: string, init?: RequestInit) => new Request(url, init) as never;
const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: "w1", from: "2348011111111", type: "text", text: { body: "hi" } }] } }] }] });
const sign = (b: string) => "sha256=" + createHmac("sha256", "appsecret").update(b).digest("hex");

beforeEach(() => {
  dispatched.length = 0;
  Object.assign(process.env, ENV);
});

describe("WhatsApp webhook", () => {
  it("answers Meta's verification handshake only with the right token", async () => {
    const ok = await GET(Object.assign(req("https://x/api/webhooks/whatsapp"), { nextUrl: new URL("https://x/?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc") }));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("abc");
    const bad = await GET(Object.assign(req("https://x/"), { nextUrl: new URL("https://x/?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=abc") }));
    expect(bad.status).toBe(403);
  });

  it("rejects an unsigned or wrongly signed call and runs nothing", async () => {
    expect((await POST(req("https://x/", { method: "POST", body }))).status).toBe(401);
    expect((await POST(req("https://x/", { method: "POST", body, headers: { "x-hub-signature-256": "sha256=00" } }))).status).toBe(401);
    expect(dispatched).toHaveLength(0);
  });

  it("hands a correctly signed message to SOL and acknowledges right away", async () => {
    const res = await POST(req("https://x/", { method: "POST", body, headers: { "x-hub-signature-256": sign(body) } }));
    expect(res.status).toBe(200);
    expect(dispatched).toEqual([{ id: "w1", from: "2348011111111", type: "text", text: "hi", media: null, profileName: null }]);
  });

  it("stays off until configured", async () => {
    delete process.env.WHATSAPP_APP_SECRET;
    expect((await POST(req("https://x/", { method: "POST", body }))).status).toBe(503);
  });
});
