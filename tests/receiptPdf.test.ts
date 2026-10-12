import { describe, expect, it, vi } from "vitest";

// The email shell pulls in the delivery log (and so the database) transitively; nothing here sends or stores anything.
vi.mock("@/lib/mail/logEmail", () => ({ logEmailDelivery: vi.fn() }));

import { buildReceiptPdf } from "@/lib/billing/receiptPdf";
import { buildPaymentReceiptEmail } from "@/lib/mail/templates";

const payment = {
  id: "ch_1",
  userId: "u1",
  kind: "SUBSCRIPTION",
  status: "PAID",
  description: "Plexo Pro plan",
  detail: "12 Oct 2026 – 12 Nov 2026",
  amountCents: 2000,
  refundedCents: 0,
  currency: "usd",
  cardBrand: "visa",
  cardLast4: "4242",
  receiptNumber: "PLX-000123",
  receiptToken: "tok",
  paidAt: "2026-10-12T12:41:24.000Z",
} as never;

describe("receipt PDF", () => {
  it("builds a real PDF", async () => {
    const bytes = await buildReceiptPdf(payment, { name: "Rukky Adanike", email: "rukky@example.com" });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("doesn't break on names the built-in fonts can't draw", async () => {
    const bytes = await buildReceiptPdf(payment, { name: "Ọlá 王 \u{1F600}", email: null });
    expect(bytes.length).toBeGreaterThan(1000);
  });
});

describe("receipt email", () => {
  const base = { receiptNumber: "PLX-000123", name: "Rukky Adanike", description: "Plexo Pro plan", detail: null, amountCents: 2000, refundedCents: 0, currency: "usd", paidAt: "2026-10-12T12:41:24.000Z", card: { brand: "visa", last4: "4242" }, downloadUrl: "https://plexo.test/r", historyUrl: "https://plexo.test/h" };

  it("shows the amount, receipt number, card and download link", () => {
    const html = buildPaymentReceiptEmail(base);
    for (const expected of ["$20.00", "PLX-000123", "Visa •••• 4242", "https://plexo.test/r", "Thanks, Rukky"]) expect(html).toContain(expected);
  });

  it("escapes anything customer-supplied", () => {
    expect(buildPaymentReceiptEmail({ ...base, name: "<script>x</script>", description: "<b>hi</b>" })).not.toContain("<script>x");
  });
});
