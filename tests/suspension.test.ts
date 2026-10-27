import { beforeEach, describe, expect, it, vi } from "vitest";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ docClient: { send }, TABLES: { core: "core" } }));

import { isUserSuspended } from "@/server/suspension";

describe("isUserSuspended", () => {
  beforeEach(() => {
    send.mockReset();
    vi.useRealTimers();
  });

  it("reports a suspended account, and reads it once within the cache window", async () => {
    send.mockResolvedValue({ Item: { suspendedAt: "2026-10-01" } });
    expect(await isUserSuspended("u-suspended")).toBe(true);
    expect(await isUserSuspended("u-suspended")).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("notices a suspension once the cache window has passed", async () => {
    vi.useFakeTimers();
    send.mockResolvedValueOnce({ Item: {} }).mockResolvedValueOnce({ Item: { suspendedAt: "2026-10-01" } });
    expect(await isUserSuspended("u-later")).toBe(false);
    vi.advanceTimersByTime(31_000);
    expect(await isUserSuspended("u-later")).toBe(true);
  });

  it("doesn't sign everyone out when the database hiccups", async () => {
    send.mockRejectedValue(new Error("throttled"));
    expect(await isUserSuspended("u-unknown")).toBe(false);
  });
});
