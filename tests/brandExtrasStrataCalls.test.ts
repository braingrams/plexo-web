import { beforeEach, describe, expect, it, vi } from "vitest";

// A mocked Strata: no network, no sign-in. It answers the component routes the way Strata's own backend does.
const strata = vi.hoisted(() => ({ calls: [] as Array<{ path: string; method: string; body?: unknown }>, existing: [] as Array<{ id: string; name: string; variant: string }>, status: 200 }));

vi.mock("@/lib/db/coreEntities", () => ({ SiteBrand: {} }));
vi.mock("@/lib/strata/session", () => ({ loadStrataToken: async () => null }));
vi.mock("@/lib/strata/autoSetup", () => ({ connectStrataInBackground: async () => false }));
vi.mock("@/lib/brand/siteBrand", () => ({
  pid: (id: string) => encodeURIComponent(id),
  strataFetch: async (path: string, _token: string, init: { method?: string; body?: unknown } = {}) => {
    strata.calls.push({ path, method: init.method ?? "GET", body: init.body });
    if (!init.method) return new Response(JSON.stringify({ data: strata.existing }), { status: 200 });
    if (strata.status === 400) return new Response(JSON.stringify({ error: { code: "COMPONENT_PROPERTY_CONSTRAINT", message: "bad property" } }), { status: 400 });
    return new Response(JSON.stringify({ data: {} }), { status: strata.status });
  },
}));

import { realExtrasDeps, StrataRefused } from "@/lib/brand/extrasWriteThrough";
import { buildComponentRow } from "@/lib/brand/brandComponents";

const row = (name: string) => buildComponentRow({ name, styles: { padding: "var(--space-3)" } }, null);

beforeEach(() => {
  strata.calls = [];
  strata.existing = [{ id: "cmp_1", name: "button", variant: "default" }];
  strata.status = 200;
});

describe("the real component calls to Strata (mocked)", () => {
  it("creates a new component with POST and updates one that exists (same name and look) with PATCH", async () => {
    const out = await realExtrasDeps.pushComponents("tok", "proj-1", [row("banner"), row("Button")]);
    expect(out).toEqual({ created: ["banner"], updated: ["button"] });
    expect(strata.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /projects/proj-1/components",
      "POST /projects/proj-1/components",
      "PATCH /projects/proj-1/components/cmp_1",
    ]);
    expect(strata.calls[1].body).toMatchObject({ name: "banner", variant: "default", props: {} });
    expect((strata.calls[1].body as { nodes: Array<{ role: string }> }).nodes[0].role).toBe("root");
  });
  it("turns a validation answer from Strata into a plain refusal (no retry)", async () => {
    strata.status = 400;
    await expect(realExtrasDeps.pushComponents("tok", "proj-1", [row("banner")])).rejects.toThrow(StrataRefused);
    await expect(realExtrasDeps.pushComponents("tok", "proj-1", [row("banner")])).rejects.toThrow(/Strata didn't accept the component "banner": bad property/);
  });
  it("treats a server error as something to retry later", async () => {
    strata.status = 503;
    const err = await realExtrasDeps.pushComponents("tok", "proj-1", [row("banner")]).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(StrataRefused);
  });
});
