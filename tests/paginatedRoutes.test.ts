import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const db = vi.hoisted(() => ({
  submissions: [] as Array<Record<string, unknown>>,
  orders: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/siteLayoutDynamo", () => ({ resolveSiteLayoutAdmin: async () => ({ context: { templateId: "t1" } }) }));
vi.mock("@/lib/commerce/adminAuthDynamo", () => ({ resolveCommerceAdmin: async () => ({ context: { organizationId: "o1" } }) }));
vi.mock("@/lib/commerce/bankTransfer", () => ({ withoutOrderSecrets: (o: unknown) => o, orderDeliveryDetails: () => [] }));
vi.mock("@/lib/commerce/orderDeletion", () => ({ orderDeleteBlocker: () => null }));
vi.mock("@/lib/db/opsEntities", () => ({
  FormSubmission: { query: { primary: () => ({ go: async () => ({ data: db.submissions }) }) } },
}));
vi.mock("@/lib/db/commerceEntities", () => ({
  CommerceOrder: { query: { primary: () => ({ go: async () => ({ data: db.orders }) }) } },
  CommerceOrderItem: { query: { primary: () => ({ go: async () => ({ data: [] }) }) } },
  CommerceBooking: { get: () => ({ go: async () => ({ data: null }) }) },
  CommerceDigitalDelivery: { query: { primary: () => ({ go: async () => ({ data: [] }) }) } },
  CommerceProduct: { get: () => ({ go: async () => ({ data: null }) }) },
}));

import { GET as getSubmissions } from "@/app/api/v1/templates/[id]/form-submissions/route";
import { GET as getOrders } from "@/app/api/v1/commerce/[templateId]/orders/route";

const req = (path: string) => new NextRequest(`https://app.test${path}`);

beforeEach(() => {
  db.submissions = Array.from({ length: 130 }, (_, i) => ({
    id: `s${i}`, formName: "Contact", createdAt: new Date(2026, 0, 1, 0, i).toISOString(),
    fields: i % 10 === 0 ? { message: "buy cheap watches http://spam.example http://spam2.example" } : { name: "Ada", message: `hello ${i}` },
  }));
  db.orders = Array.from({ length: 60 }, (_, i) => ({
    id: `o${i}`, orderNumber: `N${i}`, status: i < 3 ? "PENDING" : "PAID", paymentMethod: i < 3 ? "BANK_TRANSFER" : "ONLINE",
    customerEmail: `c${i}@x.co`, amountMinor: 100, createdAt: new Date(2026, 0, 1, 0, i).toISOString(),
  }));
});

describe("form submissions are paged, never capped", () => {
  it("returns the real total (not 200), newest first, one page at a time", async () => {
    const res = await getSubmissions(req("/x?page=2&pageSize=50"), { params: Promise.resolve({ id: "t1" }) });
    const body = await res.json();
    expect(body.total).toBe(130);
    expect(body.page).toBe(2);
    expect(body.submissions).toHaveLength(50);
    expect(body.submissions[0].id).toBe("s79"); // 130 newest-first: page 1 = s129..s80
  });
  it("the last page holds the remainder, and a page past the end falls back to it", async () => {
    const last = await (await getSubmissions(req("/x?page=3&pageSize=50"), { params: Promise.resolve({ id: "t1" }) })).json();
    expect(last.submissions).toHaveLength(30);
    const past = await (await getSubmissions(req("/x?page=99&pageSize=50"), { params: Promise.resolve({ id: "t1" }) })).json();
    expect(past.page).toBe(3);
  });
  it("likelySpamIds covers every page, so 'select likely spam' reaches messages on other pages", async () => {
    const body = await (await getSubmissions(req("/x?page=1&pageSize=25"), { params: Promise.resolve({ id: "t1" }) })).json();
    expect(body.likelySpamIds.length).toBeGreaterThan(body.submissions.filter((s: { likelySpam: boolean }) => s.likelySpam).length);
  });
});

describe("orders are paged, with the bank-transfer count over every order", () => {
  it("pages newest first with the real total", async () => {
    const body = await (await getOrders(req("/x?page=2&pageSize=25"), { params: Promise.resolve({ templateId: "t1" }) })).json();
    expect(body.total).toBe(60);
    expect(body.orders).toHaveLength(25);
    expect(body.orders[0].id).toBe("o34");
    expect(body.pageSize).toBe(25);
  });
  it("filters apply across all orders, and the awaiting count ignores the filter and the page", async () => {
    const body = await (await getOrders(req("/x?status=PAID&pageSize=25"), { params: Promise.resolve({ templateId: "t1" }) })).json();
    expect(body.total).toBe(57);
    expect(body.awaitingTransferCount).toBe(3);
  });
});
