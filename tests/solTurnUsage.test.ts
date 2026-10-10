import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  for (const t of ["CORE", "LEDGER", "COMMERCE", "CONTENT", "OPS", "IMPORT", "SOL"]) process.env[`PLEXO_${t}_TABLE`] = `test-${t.toLowerCase()}`;
});

// Watchy's 40-round turn cost nothing: a turn ending in an error charged 0, and the partial
// charge (after running out of credits) only added up the latest 20 messages — an app turn
// saves 80+. The sum now covers the whole turn.

const rows = vi.hoisted(() => [] as any[]);
vi.mock("@/lib/db/solEntities", async (orig) => {
  const real = await orig<typeof import("@/lib/db/solEntities")>();
  return {
    ...real,
    SolMessage: {
      ...real.SolMessage,
      query: { primary: () => ({ gte: ({ createdAt }: { createdAt: string }) => ({ go: async () => ({ data: rows.filter((r) => r.createdAt >= createdAt) }) }) }) },
    },
  };
});

import { sumUsageSince } from "@/lib/ai/solTurnUsage";

describe("what a turn used", () => {
  it("adds up every round of a long turn, not just the latest messages", async () => {
    rows.length = 0;
    rows.push({ role: "assistant", createdAt: "2026-10-10T08:00:00.000Z", usage: { inputTokens: 999, outputTokens: 999 } }); // an earlier turn
    for (let i = 0; i < 40; i++) {
      const t = new Date(Date.UTC(2026, 9, 10, 9, 0, i)).toISOString();
      rows.push({ role: "assistant", createdAt: t, usage: { inputTokens: 100, outputTokens: 50 } });
      rows.push({ role: "tool", createdAt: t, content: [] });
    }
    expect(await sumUsageSince("c1", "2026-10-10T09:00:00.000Z")).toEqual({ inputTokens: 4000, outputTokens: 2000 });
  });
});
