import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const st = vi.hoisted(() => ({ verifyOk: true, claims: { email: "ada@example.com", email_verified: true } as any, suspended: false, org: { status: "resolved", organizationId: "o1", role: "owner" } as any }));
vi.mock("@/lib/auth/resolveUser", () => ({ resolveUser: async () => ({ userId: "api-user", organizationId: "o9", role: null, subscriptionPlan: "FREE", customDomainLimit: null, manageLandingPagePublishing: false }) }));
vi.mock("@/server/charisolVerifier", () => ({ getCharisolPartnerVerifier: () => ({ verify: async () => { if (!st.verifyOk) throw new Error("bad"); return st.claims; } }) }));
vi.mock("@/server/charisolAccount", () => ({ resolveCharisolUser: async (c: any) => (c.email_verified ? { id: "u1", email: c.email, name: "Ada", image: null } : null) }));
vi.mock("@/server/orgDynamo", () => ({ ensureActiveOrganization: async () => st.org }));
vi.mock("@/lib/db/coreEntities", () => ({ User: { get: () => ({ go: async () => ({ data: { id: "u1", suspendedAt: st.suspended ? "x" : undefined, subscriptionPlan: "PRO" } }) }) } }));
vi.mock("@/lib/plan/entitlement", () => ({ effectivePlan: () => "PRO", planEntitlement: () => ({ plan: "PRO", onTrial: false }) }));
vi.mock("@/lib/subscription", () => ({ resolveManageLandingPagePublishing: () => false }));

import { resolveStrataCaller } from "@/lib/strata/caller";
const jwt = "aaa.bbb.ccc";
const req = (auth?: string) => new NextRequest("http://x/", { headers: auth ? { authorization: auth } : {} });

beforeEach(() => Object.assign(st, { verifyOk: true, suspended: false, claims: { email: "ada@example.com", email_verified: true }, org: { status: "resolved", organizationId: "o1", role: "owner" } }));

describe("resolveStrataCaller", () => {
  it("accepts a verified Charisol ID token", async () => {
    expect(await resolveStrataCaller(req(`Bearer ${jwt}`))).toMatchObject({ userId: "u1", organizationId: "o1", role: "owner", subscriptionPlan: "PRO" });
  });
  it("refuses a token that fails verification, an unverified email, or a suspended account", async () => {
    st.verifyOk = false;
    expect(await resolveStrataCaller(req(`Bearer ${jwt}`))).toBeNull();
    st.verifyOk = true; st.claims = { email: "a@b.c", email_verified: false };
    expect(await resolveStrataCaller(req(`Bearer ${jwt}`))).toBeNull();
    st.claims = { email: "a@b.c", email_verified: true }; st.suspended = true;
    expect(await resolveStrataCaller(req(`Bearer ${jwt}`))).toBeNull();
  });
  it("picks the owned workspace when there's no active one", async () => {
    st.org = { status: "needs-choice", organizations: [{ id: "m", name: "M", role: "editor" }, { id: "own", name: "O", role: "owner" }] };
    expect((await resolveStrataCaller(req(`Bearer ${jwt}`)))?.organizationId).toBe("own");
  });
  it("still accepts an API key", async () => {
    expect((await resolveStrataCaller(req("Bearer plx_key123")))?.userId).toBe("api-user");
  });
});
