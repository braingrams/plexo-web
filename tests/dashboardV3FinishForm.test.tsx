// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/dashboard", useSearchParams: () => new URLSearchParams() }));

import { ToastProvider } from "@/app/dashboard/_v3/ui/Toast";
import { FinishForm } from "@/app/dashboard/_v3/home/TaskForms";

const calls: string[] = [];
let fail: Record<string, { status: number; error: string }> = {};
beforeEach(() => {
  calls.length = 0;
  fail = {};
  router.refresh.mockReset();
  globalThis.fetch = vi.fn(async (url: string) => {
    calls.push(String(url));
    const f = Object.entries(fail).find(([k]) => String(url).includes(k))?.[1];
    return new Response(JSON.stringify(f ? { error: f.error } : { ok: true }), { status: f?.status ?? 200 });
  }) as unknown as typeof fetch;
});

async function mount(props: { hasAddress: boolean; address?: string | null }, onLive = vi.fn()) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => createRoot(host).render(<ToastProvider><FinishForm siteId="s1" siteName="Ama's Kitchen" baseDomain="plexopages.com" onLive={onLive} {...props} /></ToastProvider>));
  return { host, onLive };
}
const submit = async (host: HTMLElement) => act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await new Promise((r) => setTimeout(r, 0)); });

describe("Finish up", () => {
  it("one tap saves the address and puts the site online", async () => {
    const { host, onLive } = await mount({ hasAddress: false });
    expect((host.querySelector("input") as HTMLInputElement).value).toBe("amas-kitchen");
    await submit(host);
    expect(calls).toEqual(["/api/v1/domains", "/api/templates/s1/publish"]);
    expect(onLive).toHaveBeenCalled();
  });

  it("with an address already, it only asks for the last tap and shows the address", async () => {
    const { host, onLive } = await mount({ hasAddress: true, address: "ama.plexopages.com" });
    expect(host.querySelector("input")).toBeNull();
    expect(host.textContent).toContain("ama.plexopages.com");
    await submit(host);
    expect(calls).toEqual(["/api/templates/s1/publish"]);
    expect(onLive).toHaveBeenCalled();
  });

  it("a taken name stays on the step, in plain words, and nothing goes online", async () => {
    fail = { "/domains": { status: 409, error: "Domain already registered" } };
    const { host, onLive } = await mount({ hasAddress: false });
    await submit(host);
    expect(host.textContent).toContain("Someone already has that address");
    expect(calls).toEqual(["/api/v1/domains"]);
    expect(onLive).not.toHaveBeenCalled();
  });

  it("if going online fails after the address was saved, it says so and refreshes so the next try is one tap", async () => {
    fail = { "/publish": { status: 500, error: "Please try again." } };
    const { host, onLive } = await mount({ hasAddress: false });
    await submit(host);
    expect(host.textContent).toContain("Your address is saved");
    expect(router.refresh).toHaveBeenCalled();
    expect(onLive).not.toHaveBeenCalled();
  });
});
