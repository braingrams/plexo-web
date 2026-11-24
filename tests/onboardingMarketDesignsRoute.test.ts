import { beforeEach, describe, expect, it, vi } from "vitest";
import listings from "./fixtures/liveMarketplaceListings.json";

const ask = vi.fn();
vi.mock("@/lib/auth/resolveUser", () => ({ resolveUser: async () => ({ userId: "u1" }) }));
vi.mock("@/lib/marketplace", () => ({ listPublishedPageDesigns: async () => listings.map((l) => ({ ...l, compiledHtml: "<html></html>" })) }));
vi.mock("@/lib/db/contentEntities", () => ({ TemplatePurchase: { query: { primary: () => ({ go: async () => ({ data: [] }) }) } } }));
vi.mock("@/lib/commerceRateLimitDynamo", () => ({ checkCommerceRateLimit: async () => true }));
vi.mock("@/lib/onboarding/understand", () => ({ understandBusinessType: (...a: unknown[]) => ask(...a) }));

import { POST } from "@/app/api/onboarding/market-designs/route";

const call = async (brand: Record<string, unknown>, goal = "business-site") => {
  const res = await POST(new Request("http://x/api/onboarding/market-designs", { method: "POST", body: JSON.stringify({ profile: { goal, brand } }) }) as never);
  return (await res.json()) as { designs: Array<{ name: string }>; businessType?: { id: string; source: string } };
};

describe("market designs route: which kind of business", () => {
  beforeEach(() => { ask.mockReset(); vi.stubEnv("NODE_ENV", "production"); });

  it("uses what the owner picked and never asks SOL", async () => {
    const r = await call({ name: "Iron & Grain", businessType: "fitness" });
    expect(r.businessType).toMatchObject({ id: "fitness", source: "picked" });
    expect(r.designs[0].name).toMatch(/Iron/);
    expect(ask).not.toHaveBeenCalled();
  });

  it("asks SOL when the words say nothing, and uses its answer", async () => {
    ask.mockResolvedValue("care");
    const r = await call({ name: "Careline", about: "" });
    expect(ask).toHaveBeenCalledOnce();
    expect(r.businessType).toMatchObject({ id: "care", source: "sol" });
    expect(r.designs[0].name).toMatch(/Careline|Cedar|Willow/);
  });

  it("does not spend a model call when the words are already clear", async () => {
    const r = await call({ name: "Peak", about: "a gym with personal trainers and crossfit classes" });
    expect(ask).not.toHaveBeenCalled();
    expect(r.businessType).toMatchObject({ id: "fitness", source: "guess" });
  });

  it("still works when SOL is unavailable or unsure", async () => {
    ask.mockRejectedValueOnce(new Error("down"));
    const a = await call({ name: "Kemi" });
    expect(a.designs.length).toBeGreaterThan(0);
    expect(a.businessType).toBeUndefined();
    ask.mockResolvedValueOnce(null);
    const b = await call({ name: "The Spot", about: "come hang out with us" });
    expect(b.designs.length).toBeGreaterThan(0);
  });

  it("ignores a made-up business type", async () => {
    ask.mockResolvedValue(null);
    const r = await call({ name: "X Gym", businessType: "pirates" });
    expect(r.businessType?.id).toBe("fitness");
  });
});
