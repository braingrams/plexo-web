import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  for (const t of ["CORE", "LEDGER", "COMMERCE", "CONTENT", "OPS", "IMPORT", "SOL"]) process.env[`PLEXO_${t}_TABLE`] = `test-${t.toLowerCase()}`;
});

const state = vi.hoisted(() => ({ refuse: null as null | { status: number; error: string }, fail: false }));
vi.mock("@/lib/ai/generateRequest", () => ({
  resolveAiKeyForUser: async () => ({ key: { userId: "u" } }),
  resolveAiKeyByRawKey: async () => ({ error: "Invalid API key", status: 401 }),
  parseGenerateBody: () => ({ input: {} }),
  planGeneration: async () => (state.refuse ? state.refuse : { plan: {} }),
  runGeneration: async (_k: unknown, _i: unknown, _p: unknown, onProgress: (p: { characters: number; attempt: number }) => void) => {
    onProgress({ characters: 500, attempt: 1 });
    if (state.fail) throw new Error("The AI service is very busy right now. Try again in a minute.");
    return { summary: "Done", result: "<html></html>" };
  },
}));

import { prepareStreamedGeneration, type GenerationFrame } from "@/lib/ai/streamGeneration";

async function frames(caller: { userId: string } | { rawKey: string }) {
  const prepared = await prepareStreamedGeneration(caller, {});
  if ("refused" in prepared) return prepared.refused;
  const out: GenerationFrame[] = [];
  await prepared.run((f) => out.push(f));
  return out;
}

describe("streamed page generation", () => {
  it("not enough credit is refused before anything streams, as a real HTTP status", async () => {
    state.refuse = { status: 402, error: "You don't have enough AI credits for this." };
    expect(await frames({ userId: "u" })).toEqual({ status: 402, error: "You don't have enough AI credits for this." });
    state.refuse = null;
    expect(await frames({ rawKey: "bad" })).toEqual({ status: 401, error: "Invalid API key" });
  });

  it("streams started → progress → done", async () => {
    state.fail = false;
    expect(await frames({ userId: "u" })).toEqual([
      { type: "started" },
      { type: "progress", characters: 500, attempt: 1 },
      { type: "done", summary: "Done", result: "<html></html>" },
    ]);
  });

  it("a failure mid-way arrives as an error frame in plain words", async () => {
    state.fail = true;
    const out = (await frames({ userId: "u" })) as GenerationFrame[];
    expect(out.at(-1)).toEqual({ type: "error", error: "The AI service is very busy right now. Try again in a minute." });
  });
});
