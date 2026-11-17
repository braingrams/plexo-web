import { describe, expect, it, vi } from "vitest";

import { DEFAULT_PRICE_BOOK } from "@/lib/billing/pricing";
import type { PriceChangeRow } from "@/lib/billing/priceChanges";
import { emptyReport, runPriceMoves, type MoveDeps, type MoveUser, type ProviderMove, type ProviderOutcome } from "@/lib/billing/priceMove";

const NOW = new Date("2026-11-17T10:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();
const change: PriceChangeRow = {
  id: "c1", version: 1, createdAt: "2026-11-01T00:00:00Z", existingSubscribers: { when: "next_renewal" }, effectiveFrom: "2026-11-01T00:00:00Z", status: "scheduled",
  entries: [{ groupId: "NG", plan: "STARTER", interval: "monthly", currency: "NGN", provider: "PAYSTACK", oldAmount: 3000, newAmount: 3500 }],
};
const book = { ...DEFAULT_PRICE_BOOK, groups: DEFAULT_PRICE_BOOK.groups.map((g) => (g.id === "NG" ? { ...g, monthly: { ...g.monthly, STARTER: 3500 } } : g)) };
const user = (id: string, over: Partial<MoveUser> = {}): MoveUser => ({
  id, email: `${id}@x.com`, subscriptionPlan: "STARTER", planVersion: 2, subscriptionStatus: "ACTIVE", subscriptionProvider: "PAYSTACK", subscriptionId: `SUB_${id}`,
  subscriptionInterval: "monthly", subscriptionPeriodEnd: day(3), subscriptionStartedAt: "2026-06-01T00:00:00Z", billingRegion: "NG", billingCurrency: "NGN", subscriptionAmountMinor: 300_000, ...over,
});

function setup(users: MoveUser[], over: Partial<MoveDeps> = {}, outcome?: (i: ProviderMove) => ProviderOutcome | Promise<ProviderOutcome>) {
  const rows = new Map(users.map((u) => [u.id, { ...u }]));
  const started: string[] = [];
  const moveCalls: string[] = [];
  const deps: MoveDeps = {
    now: NOW, apply: true, book, changes: [change],
    listSubscribers: async function* () { for (const u of rows.values()) yield { ...u }; },
    move: async (i) => {
      moveCalls.push(i.user.id);
      return outcome ? outcome(i) : { kind: "moved", amountMinor: 350_000, interval: "monthly", detail: "ok" };
    },
    patchUser: async (id, f) => void rows.set(id, { ...rows.get(id)!, ...f }),
    markStarted: async (cid) => void started.push(cid),
    log: () => undefined,
    ...over,
  };
  return { deps, rows, started, moveCalls };
}

describe("runPriceMoves", () => {
  it("moves a subscriber whose renewal is inside the window, records it, and marks the change started", async () => {
    const t = setup([user("a")]);
    const r = await runPriceMoves(t.deps);
    expect(r).toMatchObject({ moved: 1, failed: 0 });
    expect(t.rows.get("a")).toMatchObject({ priceChangeKey: "2026-11-01T00:00:00Z#00000001", nextAmountMinor: 350_000 });
    expect(t.started).toEqual(["c1"]);
  });
  it("is idempotent: a second run moves nobody and calls the provider zero times", async () => {
    const t = setup([user("a"), user("b")]);
    await runPriceMoves(t.deps);
    t.moveCalls.length = 0;
    const again = await runPriceMoves(t.deps);
    expect(again.moved).toBe(0);
    expect(t.moveCalls).toEqual([]);
  });
  it("dry run changes nothing", async () => {
    const t = setup([user("a")], { apply: false });
    const r = await runPriceMoves(t.deps);
    expect(r).toMatchObject({ wouldMove: 1, moved: 0 });
    expect(t.rows.get("a")!.priceChangeKey).toBeUndefined();
    expect(t.started).toEqual([]);
  });
  it("respects the window: too early waits, too close to the charge is left for next cycle", async () => {
    const t = setup([user("far", { subscriptionPeriodEnd: day(20) }), user("close", { subscriptionPeriodEnd: new Date(NOW.getTime() + 3_600_000).toISOString() })]);
    const r = await runPriceMoves(t.deps);
    expect(r).toMatchObject({ moved: 0, notYet: 1, tooLate: 1 });
    expect(t.moveCalls).toEqual([]);
  });
  it("a provider failure leaves the subscriber untouched and is retried next run", async () => {
    let fail = true;
    const t = setup([user("a")], {}, () => {
      if (fail) throw new Error("Paystack down");
      return { kind: "moved", amountMinor: 350_000, interval: "monthly", detail: "ok" };
    });
    expect(await runPriceMoves(t.deps)).toMatchObject({ failed: 1, moved: 0 });
    expect(t.rows.get("a")!.priceChangeKey).toBeUndefined();
    fail = false;
    expect(await runPriceMoves(t.deps)).toMatchObject({ failed: 0, moved: 1 });
  });
  it("already on the new price at the provider: recorded, not moved again", async () => {
    const t = setup([user("a")], {}, () => ({ kind: "already", amountMinor: 350_000, detail: "same" }));
    const r = await runPriceMoves(t.deps);
    expect(r).toMatchObject({ alreadyOnPrice: 1, moved: 0 });
    expect(t.rows.get("a")!.priceChangeKey).toBeDefined();
  });
  it("skips and reports a subscriber whose price list was removed; never touches non-subscribers or cancelling ones", async () => {
    const gone = { ...book, groups: book.groups.filter((g) => g.id !== "NG") };
    const t = setup([user("a"), user("free", { subscriptionPlan: "FREE", subscriptionStatus: undefined }), user("c", { subscriptionCancelAtPeriodEnd: true })], { book: gone });
    const r = await runPriceMoves(t.deps);
    expect(r.moved).toBe(0);
    expect(r.left.map((l) => l.userId)).toEqual(["a"]);
    expect(t.moveCalls).toEqual([]);
  });
  it("does nothing when no change is scheduled, and ignores cancelled changes", async () => {
    const t = setup([user("a")], { changes: [{ ...change, status: "cancelled" }] });
    expect((await runPriceMoves(t.deps)).moved).toBe(0);
    expect(t.moveCalls).toEqual([]);
  });
  it("retries switching off a leftover Paystack subscription before anything else", async () => {
    const finishRetire = vi.fn(async () => true);
    const t = setup([user("a", { paystackRetireCode: "OLD" })], { finishRetire, changes: [] });
    await runPriceMoves(t.deps);
    expect(finishRetire).toHaveBeenCalledOnce();
  });
  it("report shape", () => expect(emptyReport(false)).toMatchObject({ apply: false, moved: 0, left: [] }));
});
