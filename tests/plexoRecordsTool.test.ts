import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  for (const t of ["CORE", "LEDGER", "COMMERCE", "CONTENT", "OPS", "IMPORT", "SOL"]) process.env[`PLEXO_${t}_TABLE`] = `test-${t.toLowerCase()}`;
});
const cards = vi.fn();
const visits = vi.fn();
vi.mock("@/lib/dashboardV3/hubData", () => ({ loadHubSiteCards: (...a: unknown[]) => cards(...a), loadHubVisits: (...a: unknown[]) => visits(...a) }));

import { ANALYTICS_MCP_TOOLS, ANALYTICS_TOOL_NAMES, handleAnalyticsTool } from "@/lib/mcp/analyticsTools";

const user = (plan: string) => ({ organizationId: "o1", userId: "u1", subscriptionPlan: plan }) as never;
const detail = { total: 9, days: [{ label: "Nov 1", views: 9 }], countries: [{ name: "Nigeria", value: 6 }], devices: [{ name: "Desktop", value: 7 }], browsers: [{ name: "Chrome", value: 8 }], os: [{ name: "macOS", value: 5 }], recent: [] };

describe("get_analytics (Plexo records)", () => {
  it("is a handled tool", () => {
    expect(ANALYTICS_TOOL_NAMES.has("get_analytics")).toBe(true);
    expect(ANALYTICS_MCP_TOOLS.some((t) => t.name === "get_analytics")).toBe(true);
  });

  it("compares every site, best first, with countries, device, browser and system", async () => {
    cards.mockResolvedValue([
      { id: "a", name: "A", address: "a.com", status: "live", visits7d: 2 },
      { id: "b", name: "B", address: "b.com", status: "live", visits7d: 9 },
      { id: "c", name: "C", address: null, status: "draft", visits7d: 0 },
    ]);
    visits.mockResolvedValue(detail);
    const r = await handleAnalyticsTool("get_analytics", {}, user("PRO"));
    expect(r.sites.map((s: any) => s.name)).toEqual(["B", "A", "C"]);
    expect(r.best).toBe("B");
    expect(r.sites[0]).toMatchObject({ topDevice: "Desktop (7)", topBrowser: "Chrome (8)", topOperatingSystem: "macOS (5)" });
    expect(r.sites[0].topCountries[0].name).toBe("Nigeria");
  });

  it("gives one site in detail", async () => {
    cards.mockResolvedValue([{ id: "b", name: "B", address: "b.com", status: "live", visits7d: 9 }]);
    visits.mockResolvedValue(detail);
    const r = await handleAnalyticsTool("get_analytics", { templateId: "b" }, user("PRO"));
    expect(r).toMatchObject({ site: "B", totalVisits: 9, source: "Plexo records" });
    expect(r.operatingSystems[0].name).toBe("macOS");
  });

  it("explains the plan limit in plain words", async () => {
    await expect(handleAnalyticsTool("get_analytics", {}, user("FREE"))).rejects.toThrow(/Starter plan/);
  });
});
