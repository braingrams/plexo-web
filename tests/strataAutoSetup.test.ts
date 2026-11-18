import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ after: (fn: () => unknown) => void fn() }));
vi.mock("@/lib/db/coreEntities", () => ({ User: {} }));
vi.mock("@/lib/charisolLink", () => ({ freshCharisolIdToken: async () => null }));
vi.mock("@/server/charisolVerifier", () => ({ getCharisolVerifier: () => ({}) }));
vi.mock("@/server/charisolAccount", () => ({ isEmailVerifiedClaim: () => true }));
vi.mock("@/lib/brand/siteBrand", () => ({ createStrataProjectFromSiteBrand: async () => ({}), getSiteBrandState: async () => ({ linked: false }) }));
vi.mock("@/lib/strata/server", () => ({ exchangeCharisolIdToken: async () => ({}) }));
vi.mock("@/lib/strata/apiUrl", () => ({ strataApiUrl: () => "https://strata.test" }));
vi.mock("@/lib/strata/session", () => ({ loadStrataToken: async () => null, saveStrataSession: async () => undefined }));

import { ensureSiteBrandInStrata } from "@/lib/strata/autoSetup";

const input = { siteId: "s1", userId: "u1", organizationId: "o1" };
const deps = (over: Partial<Parameters<typeof ensureSiteBrandInStrata>[1]> = {}) => ({
  isLinked: async () => false,
  connect: async () => true,
  create: vi.fn(async () => ({ project: { name: "Ama's Kitchen" } })),
  ...over,
});

describe("automatic brand set-up for a new website", () => {
  it("makes the Strata project and links the site", async () => {
    const d = deps();
    expect(await ensureSiteBrandInStrata(input, d)).toEqual({ status: "created", projectName: "Ama's Kitchen" });
    expect(d.create).toHaveBeenCalledWith(input);
  });
  it("leaves a site that already follows a brand alone", async () => {
    const d = deps({ isLinked: async () => true });
    expect(await ensureSiteBrandInStrata(input, d)).toEqual({ status: "already-linked" });
    expect(d.create).not.toHaveBeenCalled();
  });
  it("does nothing when Strata can't be connected without asking (website works as before)", async () => {
    const d = deps({ connect: async () => false });
    expect(await ensureSiteBrandInStrata(input, d)).toEqual({ status: "not-connected" });
    expect(d.create).not.toHaveBeenCalled();
  });
  it("never throws, whatever goes wrong", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const d = deps({ create: vi.fn(async () => { throw new Error("Add your colours first"); }) });
    expect(await ensureSiteBrandInStrata(input, d)).toEqual({ status: "failed" });
    warn.mockRestore();
  });
});
