// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Runs the real storefront script (public/commerce.js) in a browser-like DOM and buys a
// digital product from a one-page site the way a visitor would: the "buy" card, the checkout
// that opens over the page, and the thank-you that shows in place after payment.

const course = {
  id: "course-1",
  name: "AI Video Creation Course",
  slug: "ai-video-course",
  description: "Learn to make videos with AI.",
  imageUrl: "/cover.png",
  kind: "DIGITAL",
  currency: "NGN",
  priceMinor: 500000,
  compareAtPriceMinor: null,
  stockQuantity: null,
  hasVariants: false,
  priceRange: null,
};

const config = { payment: { online: true, gateway: "paystack", bankTransfer: null }, fields: [], fulfillment: { deliveryEnabled: true, pickupEnabled: true, pickupLocation: null } };

let calls: { url: string; body: Record<string, unknown> | null }[] = [];

function respond(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

async function flush() {
  // Long enough for the page watcher's once-per-frame pass (~16ms) as well as the fetches.
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 6));
}

let realLocation: Location | null = null;
afterEach(() => {
  if (realLocation) Object.defineProperty(window, "location", { configurable: true, value: realLocation });
  realLocation = null;
});

async function boot(html: string, url = "/") {
  calls = [];
  document.body.innerHTML = html;
  document.querySelectorAll(".pc-root[role=dialog]").forEach((n) => n.remove());
  window.history.pushState({}, "", url);
  window.alert = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn((u: string, init?: RequestInit) => {
      calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (u.startsWith("/api/public/commerce/products/")) return respond({ product: course });
      if (u === "/api/public/commerce/checkout-config") return respond(config);
      if (u === "/api/public/commerce/cart/items") return respond({ cartToken: "t", items: [], subtotalMinor: 0, currency: "NGN" }, 201);
      if (u === "/api/public/commerce/checkout/cart") return respond({ orderNumber: "ORD-1", authorizationUrl: "https://paystack.test/pay" });
      if (u.startsWith("/api/public/commerce/orders/lookup"))
        return respond({ order: { orderNumber: "ORD-1", status: "PAID", paymentMethod: "ONLINE", amountMinor: 500000, currency: "NGN", items: [{ nameSnapshot: course.name, quantity: 1, unitPriceMinor: 500000 }] } });
      if (u.startsWith("/api/public/commerce/cart")) return respond({ cartToken: null, items: [], subtotalMinor: 0, currency: "NGN" });
      return respond({});
    }),
  );
  const script = readFileSync(path.join(process.cwd(), "public/commerce.js"), "utf8");
  // eslint-disable-next-line no-new-func
  new Function(script)();
  document.dispatchEvent(new Event("DOMContentLoaded"));
  await flush();
}

const marker = `<div id="offer" data-plexo-commerce-product data-plexo-product-id="course-1" data-plexo-commerce-mode="buy"></div>`;
const buyButton = () => Array.from(document.querySelectorAll("button")).find((b) => /^Buy now/.test(b.textContent ?? "")) as HTMLButtonElement;
const dialog = () => document.querySelector(".pc-root[role=dialog]") as HTMLElement | null;

describe("buy-now card", () => {
  it("shows the product with one Buy now button and its price", async () => {
    await boot(marker);
    const card = document.getElementById("offer")!;
    expect(card.textContent).toContain("AI Video Creation Course");
    expect(card.textContent).toContain("Learn to make videos with AI.");
    expect(buyButton().textContent).toBe("Buy now — ₦5,000");
    expect(card.textContent).not.toContain("Add to Cart");
  });

  it("opens a checkout over the page and pays for exactly that product, returning to the same page", async () => {
    await boot(marker, "/");
    const assign = vi.fn();
    realLocation = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { pathname: "/", search: "", hash: "", set href(v: string) { assign(v); }, get href() { return "http://localhost/"; } } });
    buyButton().click();
    await flush();
    expect(dialog()).not.toBeNull();
    const email = dialog()!.querySelector("input[type=email]") as HTMLInputElement;
    email.value = "ada@example.com";
    const pay = Array.from(dialog()!.querySelectorAll("button")).find((b) => /^Pay ₦5,000/.test(b.textContent ?? "")) as HTMLButtonElement;
    pay.click();
    await flush();
    const add = calls.find((c) => c.url === "/api/public/commerce/cart/items");
    expect(add?.body).toEqual({ productId: "course-1", quantity: 1, replace: true });
    const checkout = calls.find((c) => c.url === "/api/public/commerce/checkout/cart");
    expect(checkout?.body).toMatchObject({ customerEmail: "ada@example.com", returnPath: "/" });
    expect(assign).toHaveBeenCalledWith("https://paystack.test/pay");
  });

  it("asks for a real email before charging anything", async () => {
    await boot(marker);
    buyButton().click();
    await flush();
    const pay = Array.from(dialog()!.querySelectorAll("button")).find((b) => /^Pay /.test(b.textContent ?? "")) as HTMLButtonElement;
    pay.click();
    await flush();
    expect(dialog()!.textContent).toContain("Please enter a valid email");
    expect(calls.some((c) => c.url === "/api/public/commerce/checkout/cart")).toBe(false);
  });
});

describe("after paying", () => {
  it("thanks the buyer on the same page and removes the order from the address bar", async () => {
    await boot(`<main>Welcome</main>`, "/?plexo_order=ORD-1&email=ada%40example.com&trxref=abc");
    expect(dialog()!.textContent).toContain("ORD-1");
    expect(dialog()!.textContent).toContain("Thank you");
    expect(dialog()!.textContent).toContain("ada@example.com");
    expect(window.location.search).toBe("");
  });
});

describe("pages that render late (React apps)", () => {
  it("paints a buy card added after the script loaded", async () => {
    await boot(`<div id="root"></div>`);
    document.getElementById("root")!.innerHTML = marker;
    await flush();
    expect(buyButton()).toBeTruthy();
  });

  it("paints each marker once", async () => {
    await boot(marker);
    const before = calls.filter((c) => c.url.startsWith("/api/public/commerce/products/")).length;
    document.body.appendChild(document.createElement("p"));
    await flush();
    expect(calls.filter((c) => c.url.startsWith("/api/public/commerce/products/")).length).toBe(before);
  });
});

describe("existing buttons that point at a product", () => {
  it("a link to #plexo-buy-<id> opens the on-page checkout instead of going anywhere", async () => {
    await boot(`<a id="cta" href="#plexo-buy-course-1" target="_blank">Grab the Skill — Today!</a>`);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    document.getElementById("cta")!.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    await flush();
    expect(dialog()).not.toBeNull();
    expect(dialog()!.textContent).toContain("AI Video Creation Course");
    expect(dialog()!.textContent).toContain("₦5,000");
  });

  it("any element with data-plexo-buy works, including one rendered later by an app", async () => {
    await boot(`<div id="root"></div>`);
    document.getElementById("root")!.innerHTML = `<button id="b" data-plexo-buy="course-1"><span id="inner">Enrol</span></button>`;
    await flush();
    document.getElementById("inner")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await flush();
    expect(dialog()).not.toBeNull();
  });

  it("leaves ordinary links alone", async () => {
    await boot(`<a id="other" href="#pricing">Pricing</a>`);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    document.getElementById("other")!.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    expect(dialog()).toBeNull();
  });

  it("tells the visitor if the product can't be found, rather than doing nothing", async () => {
    await boot(`<a id="cta" href="#plexo-buy-missing">Buy</a>`);
    (fetch as any).mockImplementation((u: string) => (u.startsWith("/api/public/commerce/products/") ? respond({ error: "Product not found." }, 404) : respond({})));
    document.getElementById("cta")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await flush();
    expect(window.alert).toHaveBeenCalledWith("Product not found.");
    expect(document.getElementById("cta")!.getAttribute("aria-busy")).toBeNull();
  });
});
