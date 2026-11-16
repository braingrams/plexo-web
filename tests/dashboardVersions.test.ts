import { beforeEach, describe, expect, it, vi } from "vitest";

import { planOfferAnswer, planUserSwitch } from "@/lib/dashboardVersions/actions";
import { pickOffer, resolveDashboardVersion } from "@/lib/dashboardVersions/resolve";
import { buildSwitchPatch } from "@/lib/dashboardVersions/switch";
import { validateVersionRow } from "@/lib/dashboardVersions/validate";
import { isDashboardV3 } from "@/lib/dashboardV3/flag";
import type { DashboardVersionRow } from "@/lib/dashboardVersions/types";

const classic: DashboardVersionRow = { id: "classic", label: "Version 1", isDefault: true, rolloutMode: "OFF", status: "stable" };
const v3 = (over: Partial<DashboardVersionRow> = {}): DashboardVersionRow => ({ id: "v3", label: "Version 2", rolloutMode: "OFF", status: "beta", whatsNew: ["a", "b", "c"], ...over });
const NO = { kill: null, legacyEnv: null } as const;
const r = (u: Parameters<typeof resolveDashboardVersion>[0], reg: DashboardVersionRow[], o = {}) => resolveDashboardVersion(u, reg, { ...NO, ...o });

describe("resolveDashboardVersion", () => {
  it("OFF: everyone is on the default, even with a stored choice", () => {
    expect(r({ dashboardVersion: "v3" }, [classic, v3()]).versionId).toBe("classic");
  });
  it("SELECTED: only audience members can be on it", () => {
    const reg = [classic, v3({ rolloutMode: "SELECTED" })];
    expect(r({ dashboardVersion: "v3", dashboardVersionAccess: { v3: "optional" } }, reg)).toMatchObject({ versionId: "v3", source: "choice", locked: false, switchTargets: ["classic"] });
    expect(r({ dashboardVersion: "v3" }, reg).versionId).toBe("classic"); // removed from the audience
    expect(r({ dashboardVersion: "classic", dashboardVersionAccess: { v3: "optional" } }, reg).switchTargets).toEqual(["v3"]);
  });
  it("locked assignment can't be left", () => {
    const reg = [classic, v3({ rolloutMode: "SELECTED" })];
    expect(r({ dashboardVersion: "v3", dashboardVersionLocked: true, dashboardVersionAccess: { v3: "locked" } }, reg)).toMatchObject({ versionId: "v3", source: "locked", locked: true, switchTargets: [] });
  });
  it("a lock does nothing once the version is turned OFF", () => {
    expect(r({ dashboardVersion: "v3", dashboardVersionLocked: true }, [classic, v3({ rolloutMode: "OFF" })]).versionId).toBe("classic");
  });
  it("OFFERED to everyone: own choice sticks, others default, both can switch", () => {
    const reg = [classic, v3({ rolloutMode: "OFFERED" })];
    expect(r({ dashboardVersion: "v3" }, reg)).toMatchObject({ versionId: "v3", source: "choice", switchTargets: ["classic"] });
    expect(r({}, reg)).toMatchObject({ versionId: "classic", source: "default", switchTargets: ["v3"] });
    expect(r({ dashboardVersion: "classic" }, reg).versionId).toBe("classic");
  });
  it("OFFERED to selected people only", () => {
    const reg = [classic, v3({ rolloutMode: "OFFERED", offerAudience: "selected" })];
    expect(r({}, reg).switchTargets).toEqual([]);
    expect(r({ dashboardVersionAccess: { v3: "optional" } }, reg).switchTargets).toEqual(["v3"]);
  });
  it("MANDATORY beats everything but the kill switch", () => {
    const reg = [classic, v3({ rolloutMode: "MANDATORY" })];
    expect(r({}, reg)).toMatchObject({ versionId: "v3", source: "mandatory", locked: true, switchTargets: [] });
    expect(r({ dashboardVersion: "classic", dashboardVersionLocked: true }, reg).versionId).toBe("v3");
    expect(r({ dashboardVersion: "classic" }, reg, { kill: "classic" })).toMatchObject({ versionId: "classic", source: "kill" });
  });
  it("kill switch forces classic for everyone", () => {
    expect(r({ dashboardVersion: "v3", dashboardVersionLocked: true }, [classic, v3({ rolloutMode: "SELECTED" })], { kill: " Classic " }).versionId).toBe("classic");
  });
  it("unknown version ids fall back to classic", () => {
    const reg = [classic, v3({ id: "v9", rolloutMode: "MANDATORY" })];
    expect(r({}, reg).versionId).toBe("classic");
    expect(r({ dashboardVersion: "v9", dashboardVersionLocked: true }, [classic, v3({ id: "v9", rolloutMode: "SELECTED" })]).versionId).toBe("classic");
    expect(r({}, [{ ...classic, id: "gone" }]).versionId).toBe("classic");
  });
  it("a future version works with only a registry row + an implementation", () => {
    const reg = [classic, v3(), v3({ id: "v4", label: "Newer", rolloutMode: "MANDATORY", sortOrder: 5 })];
    expect(r({}, reg, { implemented: ["classic", "v3", "v4"] })).toMatchObject({ versionId: "v4", source: "mandatory" });
  });
  it("legacy fallback only when the registry is empty", () => {
    expect(r({ dashboardV3: true }, [])).toMatchObject({ versionId: "v3", source: "legacy" });
    expect(r({ dashboardV3: false }, [], { legacyEnv: "true" }).versionId).toBe("classic");
    expect(r({}, [], { legacyEnv: "on" }).versionId).toBe("v3");
    expect(r({ dashboardV3: true }, [classic, v3()]).versionId).toBe("classic");
  });
  it("isDashboardV3 stays a thin wrapper", () => {
    expect(isDashboardV3({ dashboardV3: true }, undefined)).toBe(true);
    expect(isDashboardV3({}, "true", [classic, v3({ rolloutMode: "MANDATORY" })])).toBe(true);
    expect(isDashboardV3({ dashboardV3: true }, "true", [classic, v3()])).toBe(false);
  });
});

describe("offer eligibility", () => {
  const reg = [classic, v3({ rolloutMode: "OFFERED", remindAfterDays: 3 })];
  const now = new Date("2026-06-10T00:00:00Z");
  const offer = (u: Parameters<typeof pickOffer>[0], registry = reg) => pickOffer(u, registry, r(u, registry), now, NO);

  it("offers to people who aren't on it", () => {
    expect(offer({})).toMatchObject({ versionId: "v3", label: "Version 2", remindAfterDays: 3 });
  });
  it("not to people already on it, locked, or in the legacy mode", () => {
    expect(offer({ dashboardVersion: "v3" })).toBeNull();
    expect(pickOffer({}, [], r({}, []), now, NO)).toBeNull();
  });
  it("respects Maybe later until the reminder date, and Don't ask again for good", () => {
    expect(offer({ dashboardOffers: { v3: { snoozeUntil: "2026-06-12T00:00:00Z" } } })).toBeNull();
    expect(offer({ dashboardOffers: { v3: { snoozeUntil: "2026-06-09T00:00:00Z" } } })).not.toBeNull();
    expect(offer({ dashboardOffers: { v3: { never: true } } })).toBeNull();
  });
  it("only the chosen audience when offered to selected people", () => {
    const sel = [classic, v3({ rolloutMode: "OFFERED", offerAudience: "selected" })];
    expect(offer({}, sel)).toBeNull();
    expect(offer({ dashboardVersionAccess: { v3: "optional" } }, sel)).not.toBeNull();
  });
  it("never for OFF/SELECTED versions", () => {
    expect(offer({}, [classic, v3({ rolloutMode: "SELECTED" })])).toBeNull();
  });
});

describe("switching and answering offers (what the API enforces)", () => {
  const now = new Date("2026-06-10T00:00:00Z");
  const offered = [classic, v3({ rolloutMode: "OFFERED" })];

  it("allows an eligible switch and records history by the user", () => {
    const plan = planUserSwitch({ id: "u" }, offered, "v3", now, NO);
    expect(plan).toMatchObject({ ok: true, from: "classic", to: "v3" });
    if (plan.ok) {
      expect(plan.patch).toMatchObject({ dashboardVersion: "v3", dashboardVersionLocked: false });
      expect(plan.patch.dashboardVersionHistory).toEqual([{ at: now.toISOString(), from: "classic", to: "v3", by: "user" }]);
    }
  });
  it("lets them switch back and keeps the last switch as the truth", () => {
    const user = { id: "u", dashboardVersion: "v3", dashboardVersionHistory: [{ at: "x", from: "classic", to: "v3", by: "user" as const }] };
    const plan = planUserSwitch(user, offered, "classic", now, NO);
    expect(plan.ok && plan.patch.dashboardVersion).toBe("classic");
    expect(plan.ok && plan.patch.dashboardVersionHistory.map((h) => h.to)).toEqual(["v3", "classic"]);
  });
  it("refuses when locked, mandatory, killed, unavailable or already there", () => {
    expect(planUserSwitch({ dashboardVersion: "v3", dashboardVersionLocked: true }, offered, "classic", now, NO)).toMatchObject({ ok: false, status: 403 });
    expect(planUserSwitch({ dashboardVersion: "v3" }, [classic, v3({ rolloutMode: "MANDATORY" })], "classic", now, NO)).toMatchObject({ ok: false, status: 403 });
    expect(planUserSwitch({}, offered, "v3", now, { kill: "classic", legacyEnv: null })).toMatchObject({ ok: false, status: 403 });
    expect(planUserSwitch({}, [classic, v3({ rolloutMode: "SELECTED" })], "v3", now, NO)).toMatchObject({ ok: false, status: 403 });
    expect(planUserSwitch({}, offered, "classic", now, NO)).toMatchObject({ ok: false, status: 403 });
    expect(planUserSwitch({}, offered, "nope", now, NO)).toMatchObject({ ok: false });
    expect(planUserSwitch({}, offered, undefined, now, NO)).toMatchObject({ ok: false, status: 400 });
  });
  it("caps history and trims notes", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ at: String(i), from: "a", to: "b", by: "user" as const }));
    const p = buildSwitchPatch({ dashboardVersionHistory: many }, { to: "v3", by: "admin", adminId: "a1", note: "  hi  ", locked: true }, now);
    expect(p.dashboardVersionHistory).toHaveLength(50);
    expect(p.dashboardVersionHistory.at(-1)).toMatchObject({ by: "admin", adminId: "a1", note: "hi" });
    expect(p.dashboardVersionLocked).toBe(true);
  });
  it("Maybe later schedules a reminder after N days; Don't ask again is permanent", () => {
    const later = planOfferAnswer({}, [classic, v3({ rolloutMode: "OFFERED", remindAfterDays: 3 })], "v3", "later", now);
    expect(later.ok && later.offers.v3.snoozeUntil).toBe("2026-06-13T00:00:00.000Z");
    const dflt = planOfferAnswer({}, offered, "v3", "later", now);
    expect(dflt.ok && dflt.offers.v3.snoozeUntil).toBe("2026-06-17T00:00:00.000Z");
    const never = planOfferAnswer({ dashboardOffers: { other: { never: true } } }, offered, "v3", "never", now);
    expect(never.ok && never.offers).toMatchObject({ other: { never: true }, v3: { never: true } });
    expect(planOfferAnswer({}, offered, "zzz", "later", now)).toMatchObject({ ok: false, status: 404 });
    expect(planOfferAnswer({}, offered, "v3", "x", now)).toMatchObject({ ok: false, status: 400 });
  });
});

describe("registry validation", () => {
  it("accepts a sane row", () => {
    expect(validateVersionRow(v3({ rolloutMode: "OFFERED", remindAfterDays: 7 }), [classic])).toEqual([]);
  });
  it("explains what's wrong in plain words", () => {
    expect(validateVersionRow({ id: "V 3", label: "" })).toHaveLength(2);
    expect(validateVersionRow({ id: "v4", label: "x", rolloutMode: "NOPE" as never })[0]).toMatch(/Pick one of/);
    expect(validateVersionRow({ id: "v4", label: "x", whatsNew: ["1", "2", "3", "4"] })[0]).toMatch(/3 short bullets/);
    expect(validateVersionRow({ id: "v4", label: "x", remindAfterDays: 0 })[0]).toMatch(/1 and 365/);
    expect(validateVersionRow({ id: "v4", label: "x", isDefault: true }, [classic])[0]).toMatch(/already the default/);
    expect(validateVersionRow({ id: "v4", label: "x", rolloutMode: "MANDATORY", status: "retired" })[0]).toMatch(/retired/);
    expect(validateVersionRow({ id: "classic", label: "C", isDefault: true, rolloutMode: "OFFERED" })[0]).toMatch(/default/);
  });
});

describe("API routes", () => {
  const patch = vi.fn();
  const registry = [classic, v3({ rolloutMode: "OFFERED" })];
  let user: Record<string, unknown> | null;
  let signedIn = true;
  beforeEach(() => {
    vi.resetModules();
    patch.mockReset();
    user = { id: "u1" };
    signedIn = true;
    vi.doMock("@/server/authDynamo", () => ({ auth: async () => (signedIn ? { user: { id: "u1" } } : null) }));
    vi.doMock("@/lib/db/coreEntities", () => ({
      User: { get: () => ({ go: async () => ({ data: user }) }), patch: () => ({ set: (d: unknown) => ({ go: async () => patch(d) }) }) },
      DashboardVersion: {},
    }));
    vi.doMock("@/lib/dashboardVersions/store", () => ({ loadRegistry: async () => registry }));
  });
  const post = (body: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(body) });

  it("POST switches and records history", async () => {
    const { POST } = await import("@/app/api/dashboard-version/route");
    const res = await POST(post({ to: "v3" }));
    expect(res.status).toBe(200);
    expect(patch.mock.calls[0][0]).toMatchObject({ dashboardVersion: "v3", dashboardVersionHistory: [{ to: "v3", by: "user" }] });
  });
  it("POST refuses a locked user without writing", async () => {
    user = { id: "u1", dashboardVersion: "v3", dashboardVersionLocked: true };
    const { POST } = await import("@/app/api/dashboard-version/route");
    const res = await POST(post({ to: "classic" }));
    expect(res.status).toBe(403);
    expect(patch).not.toHaveBeenCalled();
  });
  it("requires sign-in", async () => {
    signedIn = false;
    const { POST, GET } = await import("@/app/api/dashboard-version/route");
    expect((await POST(post({ to: "v3" }))).status).toBe(401);
    expect((await GET()).status).toBe(401);
  });
  it("GET returns the resolved state", async () => {
    const { GET } = await import("@/app/api/dashboard-version/route");
    const body = await (await GET()).json();
    expect(body).toMatchObject({ versionId: "classic", locked: false, targets: [{ id: "v3" }], offer: { versionId: "v3" } });
  });
  it("offer route stores the answer", async () => {
    const { POST } = await import("@/app/api/dashboard-version/offer/route");
    expect((await POST(post({ versionId: "v3", action: "never" }))).status).toBe(200);
    expect(patch.mock.calls[0][0]).toMatchObject({ dashboardOffers: { v3: { never: true } } });
  });
});
