import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ created: [] as Array<Record<string, unknown>>, fail: null as Error | null, rows: new Map<string, Array<Record<string, unknown>>>() }));
vi.mock("@/lib/db/opsEntities", () => ({
  SecurityEvent: {
    create: (row: Record<string, unknown>) => ({
      go: async () => {
        if (h.fail) throw h.fail;
        const key = `${row.day}|${row.createdAt}|${row.id}`;
        if (h.created.some((r) => `${r.day}|${r.createdAt}|${r.id}` === key)) {
          const e = new Error("exists");
          e.name = "ConditionalCheckFailedException";
          throw e;
        }
        h.created.push(row);
      },
    }),
    query: { primary: ({ day }: { day: string }) => ({ go: async () => ({ data: h.rows.get(day) ?? [] }) }) },
  },
}));

import { listRecentSecurityEvents, maskEmail, maskIp, recordSecurityEvent, securityEventKey } from "@/lib/security/events";

beforeEach(() => {
  h.created.length = 0;
  h.fail = null;
  h.rows.clear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("security event trail", () => {
  it("keeps no full IP or email address", () => {
    expect(maskIp("203.0.113.42")).toBe("203.0.113.x");
    expect(maskIp("2001:db8:85a3:8d3:1319:8a2e:370:7348")).toBe("2001:db8:85a3:8d3::x");
    expect(maskIp(undefined)).toBe("unknown");
    expect(maskIp("not an ip")).toBe("unknown");
    expect(maskEmail("ama@example.com")).toBe("a**@example.com");
    expect(maskEmail("nonsense")).toBe("unknown");
  });

  it("collapses repeats from the same source inside 10 minutes into one row, and not across windows or sources", async () => {
    const at = Date.parse("2026-11-23T10:03:00Z");
    expect(securityEventKey({ type: "rate_limited", dedupeKey: "a" }, at)).toEqual(securityEventKey({ type: "rate_limited", dedupeKey: "a" }, at + 5 * 60_000));
    expect(securityEventKey({ type: "rate_limited", dedupeKey: "a" }, at).id).not.toBe(securityEventKey({ type: "rate_limited", dedupeKey: "a" }, at + 11 * 60_000).id);
    expect(securityEventKey({ type: "rate_limited", dedupeKey: "a" }, at).id).not.toBe(securityEventKey({ type: "rate_limited", dedupeKey: "b" }, at).id);
    expect(securityEventKey({ type: "ssrf_blocked" }, at).id).not.toBe(securityEventKey({ type: "ssrf_blocked" }, at).id); // no key: every event is its own row

    for (let i = 0; i < 5; i++) await recordSecurityEvent({ type: "rate_limited", detail: "Too many requests", ip: "203.0.113.42", dedupeKey: "forgot-password:203.0.113.42" });
    expect(h.created).toHaveLength(1);
    expect(h.created[0]).toMatchObject({ type: "rate_limited", ip: "203.0.113.x" });
  });

  it("caps and cleans what it stores", async () => {
    await recordSecurityEvent({ type: "form_bot_blocked", detail: `line one\nline two ${"x".repeat(1000)}`, actorId: "u1" });
    const row = h.created[0] as { detail: string };
    expect(row.detail.length).toBeLessThanOrEqual(300);
    expect(row.detail).not.toContain("\n");
  });

  it("never throws, even when the database is down", async () => {
    h.fail = new Error("boom");
    await expect(recordSecurityEvent({ type: "ssrf_blocked", detail: "x" })).resolves.toBeUndefined();
  });

  it("lists recent days newest first and caps the span at 7 days", async () => {
    const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    for (let i = 0; i < 10; i++) h.rows.set(day(i), [{ id: `e${i}`, type: "rate_limited", detail: "d", ip: "1.2.3.x", createdAt: `${day(i)}T00:00:00.000Z` }]);
    expect((await listRecentSecurityEvents(1)).map((e) => e.id)).toEqual(["e0"]);
    expect((await listRecentSecurityEvents(99)).map((e) => e.id)).toEqual(["e0", "e1", "e2", "e3", "e4", "e5", "e6"]);
  });
});

describe("production hardening configuration", () => {
  const stack = fs.readFileSync(path.join(process.cwd(), "cdk/lib/compute-stack.ts"), "utf8");

  it("sets a CSP of safe directives only (and never form-action), without overriding a route's own", () => {
    expect(stack).toContain(`contentSecurityPolicy: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'", override: false`);
    expect(stack).not.toMatch(/contentSecurityPolicy: "[^"]*form-action/);
  });

  it("limits camera, microphone and location to the app's own origin and switches off unused hardware APIs", () => {
    expect(stack).toContain("camera=(self), microphone=(self), geolocation=(self), usb=(), serial=(), bluetooth=()");
  });

  it("keeps the alarm count inside the free allowance of 10 and never creates a WAF", () => {
    const alarms = (stack.match(/new cloudwatch\.Alarm\(/g) ?? []).length;
    expect(alarms).toBeGreaterThan(0);
    expect(alarms).toBeLessThanOrEqual(10);
    expect(stack).toMatch(/isWafEnabled\(\) \? buildCloudFrontWebAcl/); // still opt-in, still off
  });
});
