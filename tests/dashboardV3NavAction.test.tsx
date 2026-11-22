// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/dashboard", useSearchParams: () => new URLSearchParams() }));

import { useNavAction } from "@/app/dashboard/_v3/shell/useNavAction";
import { NAV_END_EVENT, NAV_START_EVENT } from "@/app/dashboard/_v3/shell/NavProgress";

let api!: ReturnType<typeof useNavAction>;
function Probe() {
  api = useNavAction();
  return <span data-busy={String(api.busy)} />;
}
async function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => createRoot(host).render(<Probe />));
  return host;
}
const events: string[] = [];
beforeAll(() => {
  window.addEventListener(NAV_START_EVENT, () => events.push("start"));
  window.addEventListener(NAV_END_EVENT, () => events.push("end"));
});
beforeEach(() => {
  events.length = 0;
  Object.values(router).forEach((f) => f.mockReset());
});

describe("useNavAction", () => {
  it("starts the bar the moment you move and completes it when the page has arrived", async () => {
    await mount();
    await act(async () => api.push("/dashboard/sites"));
    expect(router.push).toHaveBeenCalledWith("/dashboard/sites");
    expect(events[0]).toBe("start");
    expect(events).toContain("end");
    expect(api.pending).toBe(false);
  });

  it("saves first, then refreshes, and the button stays busy for both", async () => {
    const host = await mount();
    let release!: () => void;
    const job = () => new Promise<void>((r) => (release = r));
    let p!: Promise<unknown>;
    await act(async () => { p = api.refreshAfter(job); });
    expect(host.querySelector("[data-busy]")?.getAttribute("data-busy")).toBe("true");
    expect(router.refresh).not.toHaveBeenCalled();
    await act(async () => { release(); await p; });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh when the job reports it failed, and still ends the bar", async () => {
    await mount();
    await act(async () => { await api.refreshAfter(async () => false); });
    expect(router.refresh).not.toHaveBeenCalled();
    expect(events).toEqual(["start", "end"]);
  });

  it("ends the bar and lets the error through when the job throws", async () => {
    await mount();
    await act(async () => { await expect(api.refreshAfter(async () => { throw new Error("nope"); })).rejects.toThrow("nope"); });
    expect(router.refresh).not.toHaveBeenCalled();
    expect(events).toEqual(["start", "end"]);
  });
});
