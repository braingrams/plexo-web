// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { EMAIL_EVENTS, bankProblem, cardSetupGaps, cardStatus, cleanShopAddress, emailPreview, emailProblem, isDirty, questionProblem, receiveProblem, saveStatus, shopAddressProblem, type PaymentFields } from "@/lib/commerce/shopSettingsForm";

vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }), usePathname: () => "/" }));
import { GeneralPanel } from "@/app/dashboard/_v3/hub/shop/GeneralPanel";
import { PaymentsPanel } from "@/app/dashboard/_v3/hub/shop/PaymentsPanel";
import { CheckoutPanel } from "@/app/dashboard/_v3/hub/shop/CheckoutPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pay = (over: Partial<PaymentFields> = {}): PaymentFields => ({
  provider: "BYO_PAYSTACK", paystackMode: "TEST", paystackPublic: { TEST: "", LIVE: "" }, paystackSecretSet: { TEST: false, LIVE: false }, paystackSecretNew: { TEST: "", LIVE: "" },
  stripeMode: "TEST", stripePublic: { TEST: "", LIVE: "" }, stripeSecretSet: { TEST: false, LIVE: false }, stripeSecretNew: { TEST: "", LIVE: "" }, ...over,
});

describe("settings rules", () => {
  it("knows what is unsaved and says so plainly", () => {
    expect(isDirty({ a: 1 }, { a: 1 })).toBe(false);
    expect(isDirty({ a: 1 }, { a: 2 })).toBe(true);
    expect(saveStatus({ dirty: true, saving: false, justSaved: false, error: null }).text).toMatch(/aren't saved/);
    expect(saveStatus({ dirty: false, saving: false, justSaved: true, error: null }).tone).toBe("saved");
    expect(saveStatus({ dirty: true, saving: false, justSaved: false, error: "Bad" }).tone).toBe("error");
    expect(saveStatus({ dirty: false, saving: false, justSaved: false, error: null }).tone).toBe("clean");
  });
  it("checks emails and the shop address", () => {
    expect(emailProblem("")).toBeNull();
    expect(emailProblem("nope")).toMatch(/name@example.com/);
    expect(emailProblem("a@b.co")).toBeNull();
    expect(shopAddressProblem("My Shop")).toMatch(/lowercase/);
    expect(shopAddressProblem("my-shop")).toBeNull();
    expect(cleanShopAddress(" My  Shop! ")).toBe("my-shop");
  });
  it("says what a card method still needs", () => {
    expect(cardSetupGaps(pay())).toEqual(["your Paystack public key", "your Paystack secret key"]);
    expect(cardSetupGaps(pay({ paystackPublic: { TEST: "pk", LIVE: "" }, paystackSecretNew: { TEST: "sk", LIVE: "" } }))).toEqual([]);
    expect(cardSetupGaps(pay({ provider: "PLATFORM_PAYSTACK" }))).toEqual([]);
    expect(cardSetupGaps(pay({ provider: "PLATFORM_STRIPE" }), "PENDING")[0]).toMatch(/approval/);
    expect(cardStatus(pay({ provider: "PLATFORM_PAYSTACK" })).tone).toBe("success");
    expect(cardStatus(pay({ paystackPublic: { TEST: "pk", LIVE: "" }, paystackSecretSet: { TEST: true, LIVE: false } })).text).toMatch(/test mode/);
  });
  it("checks bank details, questions and receiving", () => {
    expect(bankProblem({ enabled: false, bankName: "", accountName: "", accountNumber: "", instructions: "" })).toBeNull();
    expect(bankProblem({ enabled: true, bankName: "", accountName: "A", accountNumber: "1", instructions: "" })).toMatch(/your bank/);
    expect(bankProblem({ enabled: true, bankName: "B", accountName: "A", accountNumber: "abcdefg", instructions: "" })).toMatch(/numbers/);
    expect(questionProblem([{ label: " ", type: "text", limited: false, countries: [] }])).toMatch(/some words/);
    expect(questionProblem([{ label: "Gift", type: "text", limited: true, countries: [] }])).toMatch(/Pick at least one country/);
    expect(receiveProblem(false, false)).toMatch(/delivery or pickup/);
    expect(receiveProblem(true, false)).toBeNull();
  });
  it("has an example for every order email, using the shop's name", () => {
    for (const e of EMAIL_EVENTS) {
      const p = emailPreview(e.id, "Ada's Spices");
      expect(p.subject.length).toBeGreaterThan(5);
      expect(p.body).toContain("Ada's Spices");
    }
    expect(emailPreview("Paid", "").body).toContain("our shop");
  });
});

async function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => createRoot(host).render(node));
  return host;
}
const btn = (h: HTMLElement, text: string) => Array.from(h.querySelectorAll("button")).find((b) => b.textContent?.trim() === text) as HTMLButtonElement;
const type = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
};

const general = { siteName: "Ada's Spices", enabled: true, currency: "NGN", storefrontSlug: "shop", notificationEmail: "", hasOrders: false, productDetailLayout: { templateId: "t2", ready: true }, themeAccentColor: null, themeButtonRadius: null, autoDetectedTheme: null };

describe("GeneralPanel", () => {
  it("starts saved, shows unsaved on a change, and explains a bad email without calling the server", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ settings: {} }) }));
    vi.stubGlobal("fetch", fetchMock);
    const host = await mount(<GeneralPanel templateId="s1" initial={general} />);
    expect(host.querySelector(".plx-hsavebar")?.textContent).toContain("All changes saved");
    expect(btn(host, "Save changes").disabled).toBe(true);
    await type(host.querySelector('input[type="email"]')!, "nope");
    expect(host.querySelector(".plx-hsavebar")?.textContent).toContain("aren't saved");
    await act(async () => btn(host, "Save changes").click());
    expect(host.querySelector(".plx-hsavebar")?.textContent).toContain("name@example.com");
    expect(fetchMock).not.toHaveBeenCalled();
    await type(host.querySelector('input[type="email"]')!, "me@shop.com");
    await act(async () => btn(host, "Save changes").click());
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("/api/v1/commerce/s1/settings");
    expect(JSON.parse(call[1].body as string)).toMatchObject({ enabled: true, currency: "NGN", notificationEmail: "me@shop.com" });
    expect(host.querySelector(".plx-hsavebar")?.textContent).toContain("Saved");
    vi.unstubAllGlobals();
  });
  it("hides everything but the switch while the shop is off", async () => {
    const host = await mount(<GeneralPanel templateId="s1" initial={{ ...general, enabled: false }} />);
    expect(host.textContent).toContain("Off: nothing can be bought");
    expect(host.textContent).not.toContain("Who to tell about orders");
  });
});

const payments = { paymentProvider: "BYO_PAYSTACK", paystackMode: "TEST", paystackTestPublicKey: "", paystackLivePublicKey: "", paystackTestSecretKeyMasked: null, paystackLiveSecretKeyMasked: null, stripeMode: "TEST", stripeTestPublishableKey: "", stripeLivePublishableKey: "", stripeTestSecretKeyMasked: null, stripeLiveSecretKeyMasked: null, stripeTestWebhookSecretMasked: null, stripeLiveWebhookSecretMasked: null, bankTransferEnabled: false, bankTransferBankName: "", bankTransferAccountName: "", bankTransferAccountNumber: "", bankTransferInstructions: "" } as never;

describe("PaymentsPanel", () => {
  it("shows what's still needed and refuses to save a half-connected account", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.includes("stripe-access") ? { ok: true, json: async () => ({ status: "NONE" }) } : { ok: true, json: async () => ({ settings: {} }) })));
    const host = await mount(<PaymentsPanel templateId="s1" initial={payments} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(host.textContent).toContain("Still needed: your Paystack public key and your Paystack secret key");
    expect(host.textContent).toContain("/api/webhooks/paystack/s1");
    const choice = Array.from(host.querySelectorAll<HTMLButtonElement>("button[role=radio]")).find((b) => b.textContent?.includes("Use my own Paystack account"))!;
    expect(choice.getAttribute("aria-checked")).toBe("true");
    await type(host.querySelector('input[autocomplete="off"]')!, "pk_test_1");
    await act(async () => btn(host, "Save changes").click());
    expect(host.querySelector(".plx-hsavebar")?.textContent).toContain("add your Paystack secret key");
    vi.unstubAllGlobals();
  });
  it("lets an owner ask for Plexo's Stripe when it is not approved yet", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ status: "NONE" }) })));
    const host = await mount(<PaymentsPanel templateId="s1" initial={{ ...(payments as object), paymentProvider: "PLATFORM_STRIPE" } as never} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(host.textContent).toContain("Ask to use Plexo's Stripe");
    expect(btn(host, "Send my request")).toBeTruthy();
    vi.unstubAllGlobals();
  });
});

describe("CheckoutPanel", () => {
  it("adds a suggested question in one tap and saves the whole list", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ settings: { checkoutFields: [{ id: "q1", label: "Gift message", type: "textarea", required: false }] } }) }));
    vi.stubGlobal("fetch", fetchMock);
    const host = await mount(<CheckoutPanel templateId="s1" initial={{ fields: [], deliveryEnabled: true, pickupEnabled: false, pickupLocation: null, pickupInstructions: null }} />);
    expect(host.textContent).toContain("You haven't added any questions");
    await act(async () => btn(host, "Gift message").click());
    await act(async () => btn(host, "Save changes").click());
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.checkoutFields[0]).toMatchObject({ label: "Gift message", type: "textarea", countries: [] });
    expect(body).toMatchObject({ deliveryEnabled: true, pickupEnabled: false });
    expect(host.querySelector(".plx-hsavebar")?.textContent).toContain("Saved");
    vi.unstubAllGlobals();
  });
  it("won't let delivery and pickup both be off", async () => {
    const host = await mount(<CheckoutPanel templateId="s1" initial={{ fields: [], deliveryEnabled: true, pickupEnabled: false, pickupLocation: null, pickupInstructions: null }} />);
    await act(async () => host.querySelectorAll<HTMLInputElement>("input.plx-switch")[0].click());
    await act(async () => btn(host, "Save changes").click());
    expect(host.querySelector(".plx-hsavebar")?.textContent).toContain("delivery or pickup");
  });
});

import { ProductPagePicker } from "@/app/dashboard/_v3/hub/shop/ProductPagePicker";
import { layoutCandidateLine } from "@/lib/commerce/shopSettingsForm";

describe("ProductPagePicker", () => {
  it("offers another site's design, then reuses the one picked", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === "GET") return { ok: true, json: async () => ({ candidates: [{ layoutTemplateId: "L9", layoutName: "Product page", siteName: "Aria", updatedAt: "2026-01-05T00:00:00Z" }] }) };
      return { ok: true, json: async () => ({ layoutTemplateId: "L9" }) };
    }));
    const host = await mount(<ProductPagePicker templateId="s1" layout={null} />);
    await act(async () => btn(host, "Use a design from another site").click());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(host.textContent).toContain("From Aria");
    await act(async () => btn(host, "Use this one").click());
    const post = calls.find((c) => c.init?.method === "POST")!;
    expect(post.url).toBe("/api/v1/commerce/s1/product-detail-layout");
    expect(JSON.parse(post.init!.body as string)).toEqual({ sourceLayoutTemplateId: "L9" });
    vi.unstubAllGlobals();
  });
  it("tells you plainly when there is nothing to reuse, and shows Edit/Turn off once there is a page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ candidates: [] }) })));
    const host = await mount(<ProductPagePicker templateId="s1" layout={null} />);
    await act(async () => btn(host, "Use a design from another site").click());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(host.textContent).toContain("fresh one");
    const live = await mount(<ProductPagePicker templateId="s1" layout={{ templateId: "t2", ready: true }} />);
    expect(live.textContent).toContain("Change how it looks");
    expect(btn(live, "Turn off")).toBeTruthy();
    expect(layoutCandidateLine("X", "junk")).toBe("From X");
    vi.unstubAllGlobals();
  });
});
