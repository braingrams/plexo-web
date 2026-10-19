import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { packJson } from "@/lib/db/packed";
import { BRAND_PREFIX, VALUE_PREFIX, sweepStoredValues, type SweepStore } from "@/lib/db/valueSweep";
import { markerFor } from "@/lib/db/largeValues";

// Cleanup of stored big values: removes only what nothing points at, only when old enough, only after reading everything.

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 19);
const h = (c: string) => c.repeat(64);

function makeStore(objs: Record<string, { ageDays: number; text?: string }>) {
  const deleted: string[] = [];
  const store: SweepStore = {
    async *list(prefix) {
      for (const [key, o] of Object.entries(objs)) if (key.startsWith(prefix)) yield { key, lastModified: new Date(NOW - o.ageDays * DAY) };
    },
    async readValue(hash) {
      return objs[`${VALUE_PREFIX}${hash}`]?.text ?? null;
    },
    async delete(keys) {
      deleted.push(...keys);
    },
  };
  return { store, deleted };
}
async function* rowsOf(...rows: Array<Record<string, unknown>>) {
  for (const r of rows) yield r;
}

describe("sweeping stored values", () => {
  it("removes old objects nothing points at, and keeps everything in use or recent", async () => {
    const { store, deleted } = makeStore({
      [`${VALUE_PREFIX}${h("a")}`]: { ageDays: 40 }, // in use: a row holds its marker
      [`${VALUE_PREFIX}${h("b")}`]: { ageDays: 40 }, // old and unused
      [`${VALUE_PREFIX}${h("c")}`]: { ageDays: 2 }, // unused but fresh (grace period)
      [`${BRAND_PREFIX}${h("d")}.json.gz`]: { ageDays: 40 }, // in use: a packed design refers to it
      [`${BRAND_PREFIX}${h("e")}.json.gz`]: { ageDays: 40 }, // old and unused
    });
    const design = packJson({ format: "plexo-v2@1", pages: [], designSystemRef: { hash: h("d"), size: 500_000 }, pad: "x".repeat(20_000) });
    const rows = () => rowsOf({ id: "p1", designJson: markerFor(h("a"), 123) }, { id: "p2", designJson: design }, { id: "p3", name: "short" });
    const report = await sweepStoredValues({ rows, store, apply: true, now: NOW });
    expect(deleted.sort()).toEqual([`${BRAND_PREFIX}${h("e")}.json.gz`, `${VALUE_PREFIX}${h("b")}`].sort());
    expect(report).toMatchObject({ rows: 3, inUseValues: 1, inUseBrands: 1, staleValues: 1, staleBrands: 1, deleted: 2, dryRun: false });
  });

  it("is a dry run unless told to apply", async () => {
    const { store, deleted } = makeStore({ [`${VALUE_PREFIX}${h("b")}`]: { ageDays: 90 } });
    const report = await sweepStoredValues({ rows: () => rowsOf({ id: "x" }), store, apply: false, now: NOW });
    expect(report).toMatchObject({ staleValues: 1, deleted: 0, dryRun: true });
    expect(deleted).toEqual([]);
  });

  it("follows a stored value that itself points at another value or a brand", async () => {
    const inner = packJson({ designSystemRef: { hash: h("f"), size: 1 }, pad: "y".repeat(20_000) });
    const innerPacked = (inner as { data: string }).data; // a page stored as a big value holds its (packed) design text
    const { store, deleted } = makeStore({
      [`${VALUE_PREFIX}${h("a")}`]: { ageDays: 60, text: `{"x":"${markerFor(h("1"), 5)}"}` },
      [`${VALUE_PREFIX}${h("1")}`]: { ageDays: 60, text: innerPacked },
      [`${BRAND_PREFIX}${h("f")}.json.gz`]: { ageDays: 60 },
      [`${VALUE_PREFIX}${h("2")}`]: { ageDays: 60 },
    });
    await sweepStoredValues({ rows: () => rowsOf({ id: "p", designJson: markerFor(h("a"), 9) }), store, apply: true, now: NOW });
    expect(deleted).toEqual([`${VALUE_PREFIX}${h("2")}`]); // a, 1 and brand f are all reachable from the one row
  });

  it("deletes nothing if reading any row fails", async () => {
    const { store, deleted } = makeStore({ [`${VALUE_PREFIX}${h("b")}`]: { ageDays: 90 } });
    async function* broken() {
      yield { id: "ok" };
      throw new Error("throttled");
    }
    await expect(sweepStoredValues({ rows: broken, store, apply: true, now: NOW })).rejects.toThrow("throttled");
    expect(deleted).toEqual([]);
  });

  it("ignores things that aren't ours and tolerates a stored value that has gone missing", async () => {
    const { store } = makeStore({ [`${VALUE_PREFIX}not-a-hash`]: { ageDays: 90 } });
    const report = await sweepStoredValues({ rows: () => rowsOf({ id: "p", d: markerFor(h("9"), 3), blob: gzipSync("zzz").toString("base64").repeat(5) }), store, apply: true, now: NOW });
    expect(report.deleted).toBe(0);
    expect(report.inUseValues).toBe(1);
  });
});
