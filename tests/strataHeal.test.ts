import { beforeEach, describe, expect, it, vi } from "vitest";

const ran: string[] = [];
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void fn() }));
vi.mock("@/lib/strata/autoSetup", () => ({ ensureSiteBrandInStrata: async (i: { siteId: string }) => (ran.push(i.siteId), { status: "created" }) }));

import { __forgetHealTries, healSiteBrandInBackground } from "@/lib/strata/autoSetupBackground";

beforeEach(() => { ran.length = 0; __forgetHealTries(); });
const who = (siteId: string) => ({ siteId, userId: "u1", organizationId: "o1" });

describe("self-healing a site that has no Strata project yet", () => {
  it("starts the set-up when the Brand tab opens, then waits ten minutes before trying that site again", () => {
    const t0 = 1_000_000;
    expect(healSiteBrandInBackground(who("s1"), t0)).toBe(true);
    expect(healSiteBrandInBackground(who("s1"), t0 + 60_000)).toBe(false);
    expect(healSiteBrandInBackground(who("s1"), t0 + 9 * 60_000)).toBe(false);
    expect(healSiteBrandInBackground(who("s1"), t0 + 11 * 60_000)).toBe(true);
    expect(ran).toEqual(["s1", "s1"]);
  });
  it("each site has its own clock", () => {
    healSiteBrandInBackground(who("a"), 5);
    healSiteBrandInBackground(who("b"), 6);
    expect(ran).toEqual(["a", "b"]);
  });
});
