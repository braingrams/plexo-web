// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { friendlyTime, hoursProblem, minutesToTimeInput, timeInputToMinutes, weekRows, type HourRule } from "@/lib/commerce/bookingTimes";

vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));
import { BookingPanel } from "@/app/dashboard/_v3/hub/shop/BookingPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rule = (id: string, dayOfWeek: number, startMinute: number, endMinute: number): HourRule => ({ id, dayOfWeek, startMinute, endMinute, timezone: "Africa/Lagos" });

describe("booking times", () => {
  it("shows times as people say them", () => {
    expect(friendlyTime(540)).toBe("9:00 AM");
    expect(friendlyTime(0)).toBe("12:00 AM");
    expect(friendlyTime(13 * 60 + 30)).toBe("1:30 PM");
    expect(timeInputToMinutes(minutesToTimeInput(615))).toBe(615);
  });
  it("lays the week out Monday first with closed days empty", () => {
    const rows = weekRows([rule("a", 0, 600, 700), rule("b", 1, 600, 700), rule("c", 1, 300, 400)]);
    expect(rows.map((r) => r.name)).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
    expect(rows[0].windows.map((w) => w.id)).toEqual(["c", "b"]);
    expect(rows[1].windows).toEqual([]);
    expect(rows[6].windows).toHaveLength(1);
  });
  it("explains problems in plain words", () => {
    expect(hoursProblem("17:00", "09:00", [], 1)).toMatch(/later than opening/);
    expect(hoursProblem("", "09:00", [], 1)).toMatch(/Choose when/);
    expect(hoursProblem("09:30", "10:30", [rule("a", 1, 540, 600)], 1)).toMatch(/overlap on Monday/);
    expect(hoursProblem("09:30", "10:30", [rule("a", 2, 540, 600)], 1)).toBeNull();
  });
});

describe("BookingPanel", () => {
  it("with no service, tells the owner what to do and links to add one", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    await act(async () => createRoot(host).render(<BookingPanel templateId="s1" services={[]} />));
    expect(host.textContent).toContain("Add something people can book");
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/dashboard/sites/s1?tab=products&new=service");
  });

  it("lists the week and adds hours through the existing availability call", async () => {
    const calls: { url: string; body?: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body as string | undefined });
      if (init?.method === "POST") return { ok: true, json: async () => ({ rule: rule("n", 1, 540, 1020) }) };
      return { ok: true, json: async () => ({ rules: [rule("x", 3, 600, 660)], exceptions: [] }) };
    }));
    const host = document.createElement("div");
    document.body.appendChild(host);
    await act(async () => createRoot(host).render(<BookingPanel templateId="s1" services={[{ id: "p1", name: "Haircut", durationMinutes: 30 }]} />));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(calls[0].url).toBe("/api/v1/commerce/s1/availability?productId=p1");
    expect(host.textContent).toContain("10:00 AM to 11:00 AM");
    expect(host.textContent).toContain("Closed");
    const add = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Add hours"))!;
    await act(async () => add.click());
    const post = calls.find((c) => c.body);
    expect(JSON.parse(post!.body!)).toMatchObject({ type: "rule", productId: "p1", dayOfWeek: 1, startMinute: 540, endMinute: 1020 });
    expect(host.textContent).toContain("9:00 AM to 5:00 PM");
    vi.unstubAllGlobals();
  });
});
