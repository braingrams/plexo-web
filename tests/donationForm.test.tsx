// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { checkDraft, draftFrom, goalPercent, monthlyStatusWords, newDraft } from "@/lib/commerce/donationForm";
import type { DonationsOverview } from "@/lib/commerce/donations";

vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));
import { DonationsPanel } from "@/app/dashboard/_v3/hub/shop/DonationsPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("donation form rules", () => {
  it("turns a draft into the request, and explains problems plainly", () => {
    expect(checkDraft(newDraft())).toMatch(/name/);
    const ok = checkDraft({ ...newDraft(), name: " Help ", goal: "1,000" }) as Record<string, unknown>;
    expect(ok.name).toBe("Help");
    expect(ok.goalAmountMinor).toBe(100000);
    expect((ok.presetAmounts as unknown[]).length).toBe(4);
    expect(checkDraft({ ...newDraft(), name: "x", presets: [{ label: "", amount: "abc" }] })).toMatch(/above zero/);
    expect(checkDraft({ ...newDraft(), name: "x", presets: [], allowCustomAmount: false })).toMatch(/at least one/);
    expect(checkDraft({ ...newDraft(), name: "x", goal: "-5" })).toMatch(/goal/);
    expect((checkDraft({ ...newDraft(), name: "x", allowMonthly: false, defaultFrequency: "MONTHLY" }) as Record<string, unknown>).defaultFrequency).toBe("ONCE");
  });
  it("progress and wording", () => {
    expect(goalPercent(250, 1000)).toBe(25);
    expect(goalPercent(5000, 1000)).toBe(100);
    expect(goalPercent(5, null)).toBeNull();
    expect(monthlyStatusWords("PAST_DUE", 3)).toBe("Card was declined");
    expect(monthlyStatusWords("ACTIVE", 1)).toBe("1 payment so far");
  });
  it("round-trips a saved campaign", () => {
    const c = { id: "c1", name: "N", description: null, presetAmounts: [{ amountMinor: 5000, label: "Friend" }], defaultPresetIndex: 0, allowCustomAmount: true, minAmountMinor: 100, allowMonthly: true, defaultFrequency: "ONCE", goalAmountMinor: 200000, thankYouMessage: null, buttonLabel: null } as never;
    const d = draftFrom(c);
    expect(d.presets).toEqual([{ label: "Friend", amount: "50" }]);
    expect(d.goal).toBe("2000");
  });
});

const overview = (over: Partial<DonationsOverview> = {}): DonationsOverview => ({
  currency: "NGN", enabled: true, paymentsReady: true, monthlyReady: false,
  totals: { raisedMinor: 100000, gifts: 2, donors: 2, monthlyDonors: 0, monthlyRecurringMinor: 0 },
  campaigns: [{ id: "c1", name: "Build a well", description: null, presetAmounts: [{ amountMinor: 5000 }], defaultPresetIndex: 0, allowCustomAmount: true, minAmountMinor: 100, allowMonthly: false, defaultFrequency: "ONCE", goalAmountMinor: 400000, raisedMinor: 100000, donationCount: 2, active: true }],
  monthlyDonors: [], recentGifts: [],
  ...over,
} as unknown as DonationsOverview);

async function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => createRoot(host).render(node));
  return host;
}

describe("DonationsPanel", () => {
  it("shows progress to the goal, and an empty state with a way to start when there are no forms", async () => {
    const host = await mount(<DonationsPanel templateId="s1" initial={overview()} />);
    expect(host.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("25");
    expect(host.textContent).toContain("Build a well");
    expect(host.textContent).toContain("Where the money goes");
    const empty = await mount(<DonationsPanel templateId="s1" initial={overview({ campaigns: [] })} />);
    expect(empty.textContent).toContain("Start taking donations");
    expect(Array.from(empty.querySelectorAll("button")).some((b) => b.textContent?.includes("New donation form"))).toBe(true);
  });
  it("tells an owner with no payment account to connect one, linking to the Payments section", async () => {
    const host = await mount(<DonationsPanel templateId="s1" initial={overview({ paymentsReady: false })} />);
    expect(host.textContent).toContain("Connect a way to get paid first");
    expect(host.querySelector('a[href="/dashboard/sites/s1?tab=shop&section=settings&part=payments"]')).not.toBeNull();
  });
  it("pauses a form through the existing PATCH call", async () => {
    const calls: { url: string; method?: string; body?: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => { calls.push({ url, method: init?.method, body: init?.body as string }); return { ok: true, json: async () => overview() }; }));
    const host = await mount(<DonationsPanel templateId="s1" initial={overview()} />);
    await act(async () => Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Pause")!.click());
    expect(calls[0]).toMatchObject({ url: "/api/v1/commerce/s1/donations/c1", method: "PATCH" });
    expect(JSON.parse(calls[0].body!)).toEqual({ active: false });
    vi.unstubAllGlobals();
  });
});
