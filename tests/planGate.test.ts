import { describe, expect, it } from "vitest";
import { parsePlanGate, planGateBody, publishReturnPath, readPendingPublish, serializePendingPublish, upgradeHref, safeReturnTo, PENDING_PUBLISH_MAX_AGE_MS } from "@/lib/plan/planGate";

describe("plan gate payloads", () => {
  it("round-trips a gate body into what the dashboard shows", () => {
    const gate = parsePlanGate(planGateBody("PLAN_SITE_LIMIT_EXCEEDED", "Can't go live yet."));
    expect(gate).toEqual({ code: "PLAN_SITE_LIMIT_EXCEEDED", message: "Can't go live yet.", requiredPlan: "PRO" });
  });
  it("honours requiredPlan from the server and falls back to Starter", () => {
    expect(parsePlanGate({ error: "x", code: "PLAN_ANALYTICS", requiredPlan: "PRO" })?.requiredPlan).toBe("PRO");
    expect(parsePlanGate({ error: "x", code: "PLAN_ANALYTICS" })?.requiredPlan).toBe("STARTER");
  });
  it("recognises older uncoded upgrade responses, ignores ordinary errors", () => {
    expect(parsePlanGate({ error: "x", requiresUpgrade: true })?.code).toBe("PLAN_REQUIRED");
    expect(parsePlanGate({ error: "x", state: "upgrade" })).not.toBeNull();
    expect(parsePlanGate({ error: "Not found" })).toBeNull();
    expect(parsePlanGate({ error: "x", code: "SOMETHING_ELSE" })).toBeNull();
    expect(parsePlanGate(null)).toBeNull();
  });
  it("only returns to same-site paths", () => {
    expect(safeReturnTo("https://evil.com")).toBe("/dashboard");
    expect(safeReturnTo("//evil.com")).toBe("/dashboard");
    expect(upgradeHref("STARTER", "/dashboard/templates/a?resume=publish")).toBe("/dashboard/settings/subscription?upgrade=STARTER&returnTo=%2Fdashboard%2Ftemplates%2Fa%3Fresume%3Dpublish");
    expect(publishReturnPath("a")).toBe("/dashboard/templates/a?resume=publish");
  });
});

describe("a publish waiting on an upgrade", () => {
  const now = 1_700_000_000_000;
  const raw = serializePendingPublish({ templateId: "t1", domainType: "SUBDOMAIN", domain: "ellarose" }, now);
  it("is picked up for the same site while fresh", () => {
    expect(readPendingPublish(raw, "t1", now + 5 * 60_000)).toMatchObject({ templateId: "t1", domain: "ellarose", domainType: "SUBDOMAIN" });
  });
  it("is ignored for another site, when stale, or when damaged", () => {
    expect(readPendingPublish(raw, "t2", now)).toBeNull();
    expect(readPendingPublish(raw, "t1", now + PENDING_PUBLISH_MAX_AGE_MS + 1)).toBeNull();
    expect(readPendingPublish("{nope", "t1", now)).toBeNull();
    expect(readPendingPublish(null, "t1", now)).toBeNull();
    expect(readPendingPublish(JSON.stringify({ kind: "publish", templateId: "t1", domainType: "BUY", domain: "x", savedAt: now }), "t1", now)).toBeNull();
  });
});
