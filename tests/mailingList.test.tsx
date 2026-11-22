// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { connectProblem, friendlyConnectError, groupLabel, stepFor } from "@/lib/commerce/mailingList";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
import { MailingConnect } from "@/app/dashboard/_v3/hub/shop/MailingConnect";
import { EmailsPanel } from "@/app/dashboard/_v3/hub/shop/EmailsPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("mailing list rules", () => {
  it("says what to fix in plain words", () => {
    const ok = { email: "a@b.co", password: "x", name: "Ada", phone: "0801234567" };
    expect(connectProblem("login", { ...ok, email: "nope" })).toMatch(/name@example.com/);
    expect(connectProblem("login", { ...ok, password: "" })).toMatch(/password/);
    expect(connectProblem("register", { ...ok, name: "" })).toMatch(/your name/);
    expect(connectProblem("register", { ...ok, phone: "12" })).toMatch(/phone/);
    expect(connectProblem("login", ok)).toBeNull();
    expect(connectProblem("login", { ...ok, name: "", phone: "" })).toBeNull();
  });
  it("tracks the three steps and softens errors", () => {
    expect(stepFor(false, false)).toBe(1);
    expect(stepFor(false, true)).toBe(2);
    expect(stepFor(true, false)).toBe(3);
    expect(friendlyConnectError("Invalid credentials")).toMatch(/didn't accept/);
    expect(friendlyConnectError("Verification code expired")).toMatch(/didn't work/);
    expect(friendlyConnectError("Some other thing")).toBe("Some other thing");
    expect(friendlyConnectError("")).toMatch(/Something went wrong/);
    expect(groupLabel({ title: "VIPs", totalContacts: 1 })).toBe("VIPs (1 person)");
  });
});

async function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => createRoot(host).render(node));
  return host;
}
const btn = (h: HTMLElement, t: string) => Array.from(h.querySelectorAll("button")).find((b) => b.textContent?.trim() === t) as HTMLButtonElement;
const type = async (el: HTMLInputElement, value: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });

describe("MailingConnect", () => {
  it("signs in, asks for the code, then connects", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      const b = JSON.parse(init.body as string);
      bodies.push(b);
      return { ok: true, json: async () => (b.action === "login" ? { status: "verify_required", email: b.email } : { status: "connected" }) };
    }));
    const done = vi.fn();
    const host = await mount(<MailingConnect templateId="s1" onConnected={done} />);
    expect(host.textContent).toContain("1. Sign in to MailDrip");
    await act(async () => btn(host, "Sign in to MailDrip").click());
    expect(host.textContent).toContain("name@example.com");
    expect(bodies).toHaveLength(0);
    await type(host.querySelector('input[type="email"]')!, "ada@shop.com");
    await type(host.querySelector('input[type="password"]')!, "secret");
    await act(async () => btn(host, "Sign in to MailDrip").click());
    expect(host.textContent).toContain("MailDrip sent a code to ada@shop.com");
    await type(host.querySelector("input")!, "123456");
    await act(async () => btn(host, "Confirm and connect").click());
    expect(bodies.map((b) => b.action)).toEqual(["login", "verify"]);
    expect(done).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it("shows a friendly message when MailDrip says no", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: "Invalid credentials" }) })));
    const host = await mount(<MailingConnect templateId="s1" onConnected={() => {}} />);
    await type(host.querySelector('input[type="email"]')!, "ada@shop.com");
    await type(host.querySelector('input[type="password"]')!, "bad");
    await act(async () => btn(host, "Sign in to MailDrip").click());
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/didn't accept/);
    vi.unstubAllGlobals();
  });
});

const flags = { Paid: true, Processing: true, ReadyForPickup: true, Shipped: true, Completed: true, Refunded: true };
describe("EmailsPanel mailing list", () => {
  it("not connected: shows the steps; connected: lets you pick lists and saves them with the order emails", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes("/groups")) return { ok: true, json: async () => ({ groups: [{ id: "g1", title: "Customers", description: null, totalContacts: 4 }] }) };
      return { ok: true, json: async () => ({ settings: {} }) };
    }));
    const off = await mount(<EmailsPanel templateId="s1" initial={{ shopName: "Ada", flags, mailing: { maildripConnected: false, maildripPaidGroupId: "", maildripNewsletterGroupId: "", newsletterPopupEnabled: false, notificationEmail: "" } }} />);
    expect(off.textContent).toContain("Not connected");
    expect(off.textContent).toContain("2. Confirm it's you");
    const on = await mount(<EmailsPanel templateId="s1" initial={{ shopName: "Ada", flags, mailing: { maildripConnected: true, maildripPaidGroupId: "", maildripNewsletterGroupId: "", newsletterPopupEnabled: false, notificationEmail: "" } }} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(on.textContent).toContain("Customers (4 people)");
    const select = on.querySelectorAll("select")[0] as HTMLSelectElement;
    await act(async () => { select.value = "g1"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => btn(on, "Save changes").click());
    const put = calls.find((c) => c.init?.method === "PUT")!;
    expect(JSON.parse(put.init!.body as string)).toMatchObject({ maildripPaidGroupId: "g1", notifyCustomerOnPaid: true });
    vi.unstubAllGlobals();
  });
});
