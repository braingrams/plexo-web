import { describe, expect, it, vi } from "vitest";


import { settle } from "@/lib/projects/settle";

// app_build used to answer "Finishing up…" as soon as the build itself was done, while the
// finaliser was still deploying server functions — and SOL then called app_build_status seven
// times (each a paid round) on staging. The wait now covers the post-build steps too.

describe("waiting for a build to fully finish", () => {
  it("keeps waiting through 'finishing up' and answers once, when it's done", async () => {
    const states = [{ pending: true, summary: "Finishing up…" }, { pending: true, summary: "Finishing up…" }, { pending: false, summary: "Built in 2.6s" }];
    const next = vi.fn(async () => states.shift()!);
    const sleeps: number[] = [];
    const out = await settle(next, Date.now() + 60_000, async (ms) => void sleeps.push(ms));
    expect(out.summary).toBe("Built in 2.6s");
    expect(next).toHaveBeenCalledTimes(3);
    expect(sleeps[1]).toBeGreaterThan(sleeps[0]); // backs off
  });

  it("answers with where it got to when the time is up", async () => {
    const next = vi.fn(async () => ({ pending: true }));
    const out = await settle(next, Date.now() - 1, async () => {});
    expect(out.pending).toBe(true);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("doesn't wait at all when it's already done", async () => {
    const sleep = vi.fn(async () => {});
    await settle(async () => ({ pending: false }), Date.now() + 60_000, sleep);
    expect(sleep).not.toHaveBeenCalled();
  });
});
