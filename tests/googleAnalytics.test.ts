import { beforeEach, describe, expect, it } from "vitest";
import { buildAuthUrl, createPkce, createState, hasRequiredScopes, verifyState } from "@/lib/googleAnalytics/oauth";
import { buildInsights } from "@/lib/googleAnalytics/insights";
import { MockAnalyticsDataClient } from "@/lib/googleAnalytics/dataClient";

beforeEach(() => {
  process.env.GOOGLE_ANALYTICS_TOKEN_ENCRYPTION_SECRET = "test-secret";
  process.env.GOOGLE_ANALYTICS_CLIENT_ID = "client-id";
});

describe("Google sign-in state and PKCE", () => {
  it("accepts its own state and rejects tampering or expiry", () => {
    const { state } = createState("site1", "user1");
    expect(verifyState(state)?.siteId).toBe("site1");
    expect(verifyState(`${state}x`)).toBeNull();
    const [payload] = state.split(".");
    expect(verifyState(`${payload}.AAAA`)).toBeNull();
    expect(verifyState(state, Date.now() + 11 * 60 * 1000)).toBeNull();
    expect(verifyState(null)).toBeNull();
  });
  it("builds an offline, PKCE-protected request for read and setup permissions", () => {
    const { challenge } = createPkce();
    const url = new URL(buildAuthUrl({ state: "s", challenge }));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")).toContain("analytics.readonly");
    expect(url.searchParams.get("scope")).toContain("analytics.edit");
  });
  it("notices when the owner unticked a permission", () => {
    expect(hasRequiredScopes("openid https://www.googleapis.com/auth/analytics.readonly")).toBe(false);
    expect(hasRequiredScopes("https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/analytics.edit")).toBe(true);
  });
});

describe("plain-language insights", () => {
  it("explains a report in words", async () => {
    const report = await new MockAnalyticsDataClient().getReport("properties/1", 28);
    const insights = buildInsights(report);
    expect(insights.length).toBeGreaterThan(2);
    expect(insights.length).toBeLessThanOrEqual(5);
    expect(insights[0].text).toMatch(/visitors/);
  });
  it("encourages sharing when there are no visitors", async () => {
    const report = await new MockAnalyticsDataClient().getReport("properties/1", 7);
    const empty = { ...report, totals: { ...report.totals, visitors: 0 } };
    expect(buildInsights(empty)[0].text).toMatch(/Nobody has visited yet/);
  });
});
