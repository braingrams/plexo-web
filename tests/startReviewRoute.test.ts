import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { userId: "u", organizationId: "o", role: null as string | null } as null | { userId: string; organizationId: string; role: string | null },
  site: null as null | Record<string, any>,
  patches: [] as Record<string, any>[],
  forbid: false,
  solSeen: null as null | string,
  chats: [] as unknown[],
  session: { user: { id: "u" } } as null | { user: { id: string } },
}));

vi.mock("@/lib/auth/resolveUser", () => ({ resolveUser: async () => h.user }));
vi.mock("@/server/requirePermissionDynamo", () => ({ requirePermission: () => (h.forbid ? new Response(JSON.stringify({ error: "no" }), { status: 403 }) : null) }));
vi.mock("@/server/requireTemplateScope", () => ({ requireTemplateScope: () => null }));
vi.mock("@/server/slugDynamo", () => ({ isValidUuid: (id: string) => id !== "bad" }));
vi.mock("@/lib/db/contentEntities", () => ({
  Template: {
    get: () => ({ go: async () => ({ data: h.site }) }),
    patch: () => ({ set: (v: Record<string, any>) => ({ go: async () => { h.patches.push(v); return {}; } }) }),
  },
}));
vi.mock("@/lib/db/solEntities", () => ({ SolConversation: { query: { primary: () => ({ go: async () => ({ data: h.chats }) }) } } }));
vi.mock("@/lib/db/coreEntities", () => ({
  Member: { get: () => ({ go: async () => ({ data: { role: "owner" } }) }) },
  User: {
    get: () => ({ go: async () => ({ data: { id: "u", solIntroSeenAt: h.solSeen } }) }),
    patch: () => ({ set: (v: Record<string, any>) => ({ go: async () => { h.solSeen = v.solIntroSeenAt; return {}; } }) }),
  },
}));
vi.mock("@/server/authDynamo", () => ({ auth: async () => h.session }));

import { POST } from "@/app/api/templates/[id]/start-review/route";
import * as solIntro from "@/app/api/dashboard/sol-intro/route";

const call = (id = "1b4e28ba-2fa1-11d2-883f-0016d3cca427") => POST(new Request("http://x", { method: "POST" }) as any, { params: Promise.resolve({ id }) });
const iso = (sec: number) => new Date(Date.parse("2026-01-01T10:00:00Z") + sec * 1000).toISOString();

beforeEach(() => {
  h.user = { userId: "u", organizationId: "o", role: null };
  h.site = { id: "s", organizationId: "o", createdAt: iso(0), updatedAt: iso(10) };
  h.patches = [];
  h.forbid = false;
  h.solSeen = null;
  h.chats = [];
  h.session = { user: { id: "u" } };
});

describe("POST /api/templates/:id/start-review", () => {
  it("sets the flag once", async () => {
    expect((await call()).status).toBe(200);
    expect(h.patches).toHaveLength(1);
    expect(typeof h.patches[0].startReviewedAt).toBe("string");
  });
  it("is idempotent and writes nothing for a site that is already flagged or edited", async () => {
    h.site = { ...h.site!, startReviewedAt: iso(10) };
    expect((await call()).status).toBe(200);
    h.site = { id: "s", organizationId: "o", createdAt: iso(0), updatedAt: iso(900) };
    expect((await call()).status).toBe(200);
    expect(h.patches).toHaveLength(0);
  });
  it("rejects signed-out, read-only, unknown and other people's sites", async () => {
    h.user = null;
    expect((await call()).status).toBe(401);
    h.user = { userId: "u", organizationId: "o", role: null };
    h.forbid = true;
    expect((await call()).status).toBe(403);
    h.forbid = false;
    expect((await call("bad")).status).toBe(404);
    h.site = { ...h.site!, organizationId: "someone-else" };
    expect((await call()).status).toBe(404);
    expect(h.patches).toHaveLength(0);
  });
});

describe("/api/dashboard/sol-intro", () => {
  it("is not seen on a first visit, then seen after POST", async () => {
    expect(await (await solIntro.GET()).json()).toEqual({ seen: false });
    await solIntro.POST();
    expect(typeof h.solSeen).toBe("string");
    expect(await (await solIntro.GET()).json()).toEqual({ seen: true });
  });
  it("someone who already has SOL chats has met it", async () => {
    h.chats = [{}];
    expect(await (await solIntro.GET()).json()).toEqual({ seen: true });
    expect(h.solSeen).not.toBeNull();
  });
  it("needs a signed-in person", async () => {
    h.session = null;
    expect((await solIntro.GET()).status).toBe(401);
    expect((await solIntro.POST()).status).toBe(401);
  });
});
