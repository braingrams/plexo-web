// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { SitePlanNotice } from "@/app/dashboard/_components/SitePlanNotice";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

const status = {
  plan: "FREE", previousPlan: null, trialAvailable: true, homeOnly: true, isApp: false,
  site: { id: "s", name: "Kharis", isLive: true, liveAddress: null, pausedCustomDomains: [], everPublished: true },
  otherLiveSite: null, pageCount: 4, unpublishedPageCount: 0, archivedByPlanPageCount: 0,
  secondaryLinks: [{ href: "/about", label: "About" }],
};

async function mount() {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => status })));
  const host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => createRoot(host).render(<SitePlanNotice templateId="t1" />));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return host;
}
const byText = (host: HTMLElement, t: string) => Array.from(host.querySelectorAll("button")).find((b) => b.textContent === t);

afterEach(() => { document.body.innerHTML = ""; window.sessionStorage.clear(); });

describe("SitePlanNotice", () => {
  it("shows ONE status line, not a stack of banners", async () => {
    const host = await mount();
    expect(host.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(host.textContent).toContain("1 link on this page goes to pages that aren't live yet · and 1 more");
  });
  it("opens the details with Show links and the trial offer", async () => {
    const host = await mount();
    await act(async () => byText(host, "Details")!.click());
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => byText(host, "Show links")!.click());
    expect(host.textContent).toContain("About");
    expect(host.textContent).toContain("Try Starter free for 14 days");
  });
  it("can be hidden for this visit", async () => {
    const host = await mount();
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label^="Hide"]')!.click());
    expect(host.textContent).toBe("");
    expect(window.sessionStorage.getItem("plexo.siteNotice.dismissed.t1")).toBe("1");
  });
});
