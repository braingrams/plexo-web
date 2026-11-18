import { describe, expect, it, vi } from "vitest";

vi.mock("@charisol/plexo-sdk/v2/strata", () => ({ createStrataClient: () => ({}) }));
vi.mock("@/lib/db/coreEntities", () => ({ SiteBrand: {} }));
vi.mock("@/lib/db/contentEntities", () => ({ Template: {} }));
vi.mock("@/lib/strata/session", () => ({ loadStrataToken: async () => null }));
vi.mock("@/lib/strata/apiUrl", () => ({ strataApiUrl: () => "https://strata.test" }));
vi.mock("@/lib/strata/autoSetup", () => ({ connectStrataInBackground: async () => false, ensureSiteBrandInStrata: async () => ({ status: "failed" }) }));
vi.mock("@/lib/brand/siteBrand", () => ({ publishStrataProject: async () => "published", runSiteBrandUpdate: async () => ({ outcome: "updated" }) }));

import { sendBrandToStrata, SENT_NOTE, WAITING_NOTE, type WriteDeps } from "@/lib/brand/writeThrough";
import { strataPushPrimary as pushPrimary } from "@/lib/brand/brandModel";

const input = { siteId: "s1", userId: "u1", organizationId: "o1" };
function deps(over: Partial<WriteDeps> = {}): WriteDeps & { calls: string[] } {
  const calls: string[] = [];
  const d: WriteDeps = {
    localBrand: async () => ({ colors: ["#E4572E", "#1F6FEB"], logoUrl: "https://x/logo.png" }),
    link: async () => ({ projectId: "p1", userId: "u1", projectLogo: null }),
    session: async () => "tok",
    push: async () => { calls.push("push"); },
    uploadLogo: async () => { calls.push("logo"); },
    publish: async () => { calls.push("publish"); return "published"; },
    setPending: async (_s, pending) => { calls.push(pending ? "pending" : "clear"); },
    refreshSite: async () => { calls.push("refresh"); },
    create: async () => ({ status: "created", projectName: "Ama" }),
    siteName: async () => "Ama",
    ...over,
  };
  return Object.assign(d, { calls });
}

describe("sending a brand change to Strata", () => {
  it("pushes colours and a new logo, publishes, clears the waiting flag and refreshes Plexo's copy", async () => {
    const d = deps();
    expect(await sendBrandToStrata(input, d)).toEqual({ state: "in-strata", message: SENT_NOTE });
    expect(d.calls).toEqual(["push", "logo", "publish", "clear", "refresh"]);
  });
  it("does not re-upload a logo Strata already has", async () => {
    const d = deps({ link: async () => ({ projectId: "p1", userId: "u1", projectLogo: "https://x/logo.png" }) });
    await sendBrandToStrata(input, d);
    expect(d.calls).not.toContain("logo");
  });
  it("keeps Plexo's copy and marks it waiting when Strata can't be reached (never throws)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const d = deps({ push: async () => { throw new Error("network"); } });
    expect(await sendBrandToStrata(input, d)).toEqual({ state: "waiting", message: WAITING_NOTE });
    expect(d.calls).toContain("pending");
    warn.mockRestore();
  });
  it("is waiting (not failed) when Strata won't publish or there is no session", async () => {
    const a = deps({ publish: async () => "refused" });
    expect((await sendBrandToStrata(input, a)).state).toBe("waiting");
    const b = deps({ session: async () => null });
    expect((await sendBrandToStrata(input, b)).state).toBe("waiting");
    expect(b.calls).toContain("pending");
  });
  it("makes the project when the site has none yet", async () => {
    const d = deps({ link: async () => null });
    const r = await sendBrandToStrata(input, d);
    expect(r.state).toBe("created");
    expect(r.message).toContain("Ama");
  });
  it("says waiting when the project can't be made yet", async () => {
    const d = deps({ link: async () => null, create: async () => ({ status: "not-connected" }) });
    expect((await sendBrandToStrata(input, d)).state).toBe("waiting");
  });
});

describe("main colour push", () => {
  const tok = { key: "--color-brand-primary", name: "Brand Primary", value: "#B8F34A", type: "color", unit: null, layer: "brand", comment: null };
  it("changes only an existing main-colour token, and only when it differs", () => {
    expect(pushPrimary([tok as never], "#E4572E").tokens[0].value).toBe("#E4572E");
    expect(pushPrimary([tok as never], "#b8f34a").tokens).toEqual([]);
    expect(pushPrimary([], "#E4572E").tokens).toEqual([]);
    expect(pushPrimary([tok as never], "red").tokens).toEqual([]);
  });
});
