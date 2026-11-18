import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/coreEntities", () => ({ SiteBrand: {} }));
vi.mock("@/lib/strata/session", () => ({ loadStrataToken: async () => null }));
vi.mock("@/lib/strata/autoSetup", () => ({ connectStrataInBackground: async () => false }));

import { flushWaitingExtras, NOT_IN_STRATA_NOTE, sendComponentsToStrata, sendTokensToStrata, StrataRefused, WAITING_EXTRAS_NOTE, type ExtrasDeps } from "@/lib/brand/extrasWriteThrough";
import { buildComponentRow } from "@/lib/brand/brandComponents";
import type { TokenRequest } from "@/lib/brand/brandModel";

const who = { siteId: "s1", userId: "u1", organizationId: "o1" };
const banner = buildComponentRow({ name: "banner", styles: { padding: "var(--space-5)" } }, null);
const card = buildComponentRow({ name: "card", styles: { padding: "var(--space-3)" } }, null);

function deps(over: Partial<ExtrasDeps> = {}, waiting: { components?: typeof banner[]; tokens?: TokenRequest | null } = {}): ExtrasDeps & { calls: string[]; sent: unknown[] } {
  const calls: string[] = [];
  const sent: unknown[] = [];
  const d: ExtrasDeps = {
    link: async () => ({ projectId: "p1", userId: "u1" }),
    session: async () => "tok",
    pending: async () => ({ components: waiting.components ?? [], tokens: waiting.tokens ?? null }),
    pushComponents: async (_t, _p, rows) => { calls.push("push-components"); sent.push(rows.map((r) => r.name)); return { created: rows.map((r) => String(r.name)), updated: [] }; },
    pushTokens: async (_t, _p, req) => { calls.push("push-tokens"); sent.push(req); return { sent: ["main colour"], skipped: [] }; },
    publish: async () => { calls.push("publish"); return "published"; },
    queue: async (_s, patch) => { calls.push(`queue:${Object.keys(patch).join(",")}`); },
    clear: async (_s, which) => { calls.push(`clear:${which.join(",")}`); },
    keepCopy: async () => { calls.push("keep-copy"); },
    refreshSite: async () => { calls.push("refresh"); },
    ...over,
  };
  return Object.assign(d, { calls, sent });
}

describe("sending components made in Plexo to Strata", () => {
  it("creates them in the project, publishes, clears what waited and refreshes Plexo's copy", async () => {
    const d = deps();
    const r = await sendComponentsToStrata({ ...who, components: [banner] }, d);
    expect(r).toMatchObject({ state: "in-strata", created: ["banner"], updated: [] });
    expect(r.message).toMatch(/live on your website/);
    expect(d.calls).toEqual(["push-components", "publish", "clear:components", "refresh"]);
  });
  it("says plainly when the site's brand isn't in Strata", async () => {
    const r = await sendComponentsToStrata({ ...who, components: [banner] }, deps({ link: async () => null }));
    expect(r).toMatchObject({ state: "not-set-up", message: NOT_IN_STRATA_NOTE });
  });
  it("keeps Plexo's copy and queues the component when there is no Strata session", async () => {
    const d = deps({ session: async () => null });
    const r = await sendComponentsToStrata({ ...who, components: [banner] }, d);
    expect(r).toMatchObject({ state: "waiting", message: WAITING_EXTRAS_NOTE });
    expect(d.calls).toEqual(["keep-copy", "queue:components"]);
  });
  it("keeps and queues it when Strata can't be reached (never throws)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const d = deps({ pushComponents: async () => { throw new Error("network"); } });
    expect((await sendComponentsToStrata({ ...who, components: [banner] }, d)).state).toBe("waiting");
    expect(d.calls).toEqual(["keep-copy", "queue:components"]);
    warn.mockRestore();
  });
  it("keeps and queues it when Strata won't publish yet", async () => {
    const d = deps({ publish: async () => "unavailable" });
    expect((await sendComponentsToStrata({ ...who, components: [banner] }, d)).state).toBe("waiting");
    expect(d.calls).toContain("queue:components");
    expect(d.calls).not.toContain("refresh");
  });
  it("does not retry forever when Strata refuses the component itself: it says why", async () => {
    const d = deps({ pushComponents: async () => { throw new StrataRefused('Strata didn\'t accept the component "banner".'); } });
    const r = await sendComponentsToStrata({ ...who, components: [banner] }, d);
    expect(r).toMatchObject({ state: "refused", message: expect.stringContaining("banner") });
    expect(d.calls).toEqual([]);
  });
  it("sends what was waiting together with the new one", async () => {
    const d = deps({}, { components: [card] });
    await sendComponentsToStrata({ ...who, components: [banner] }, d);
    expect(d.sent[0]).toEqual(["card", "banner"]);
  });
});

describe("sending token changes to Strata", () => {
  const request: TokenRequest = { colours: { primary: "#112233" } };
  it("pushes, publishes, clears and refreshes", async () => {
    const d = deps();
    const r = await sendTokensToStrata({ ...who, request }, d);
    expect(r).toMatchObject({ state: "in-strata", changed: ["main colour"] });
    expect(r.message).toMatch(/Saved in Strata \(main colour\)/);
    expect(d.calls).toEqual(["push-tokens", "publish", "clear:tokens", "refresh"]);
  });
  it("doesn't publish or refresh when nothing changed, and passes the plain reasons through", async () => {
    const d = deps({ pushTokens: async () => ({ sent: [], skipped: ["The main colour must be a hex colour like #E4572E."] }) });
    const r = await sendTokensToStrata({ ...who, request }, d);
    expect(r.state).toBe("in-strata");
    expect(r.message).toMatch(/hex colour/);
    expect(d.calls).toEqual(["clear:tokens"]);
  });
  it("keeps the change when Strata is out of reach", async () => {
    const d = deps({ session: async () => null });
    expect((await sendTokensToStrata({ ...who, request }, d)).state).toBe("waiting");
    expect(d.calls).toEqual(["keep-copy", "queue:tokens"]);
  });
  it("sends a waiting request merged with the new one", async () => {
    const d = deps({}, { tokens: { colours: { accent: "#445566" }, radius: 4 } });
    await sendTokensToStrata({ ...who, request }, d);
    expect(d.sent[0]).toMatchObject({ colours: { accent: "#445566", primary: "#112233" }, radius: 4 });
  });
});

describe("the retry", () => {
  it("sends only what is waiting", async () => {
    const d = deps({}, { components: [card], tokens: { radius: 6 } });
    await flushWaitingExtras(who, d);
    expect(d.calls.filter((c) => c.startsWith("push"))).toEqual(["push-components", "push-tokens"]);
  });
  it("does nothing when nothing is waiting", async () => {
    const d = deps();
    await flushWaitingExtras(who, d);
    expect(d.calls).toEqual([]);
  });
});
