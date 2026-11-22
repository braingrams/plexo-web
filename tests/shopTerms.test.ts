import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/commerceEntities", () => ({}));
vi.mock("@/lib/db/contentEntities", () => ({}));
vi.mock("@/lib/mail/logEmail", () => ({ logEmailDelivery: () => {} }));

import { TERMS_PATH, defaultTerms, renderTermsHtml, termsLink, termsPromptForSol, termsUrlProblem } from "@/lib/commerce/terms";
import { applyCheckoutSettingsInput, checkoutSettingsView, CheckoutSettingsError } from "@/lib/commerce/checkoutSettings";
import { buildOrderStatusEmail } from "@/lib/mail/templates";

describe("terms of sale", () => {
  it("links to the owner's page, else to the hosted copy, else nothing", () => {
    expect(termsLink({ termsUrl: " https://x.com/t " , termsText: "a" }, "https://shop.com")).toEqual({ url: "https://x.com/t", custom: true });
    expect(termsLink({ termsText: "Our rules" }, "https://shop.com/")).toEqual({ url: `https://shop.com${TERMS_PATH}`, custom: false });
    expect(termsLink({ termsText: "  " }, "https://shop.com")).toBeNull();
    expect(termsLink(null, "https://shop.com")).toBeNull();
  });
  it("writes a friendly default with the shop's name and contact", () => {
    const t = defaultTerms("Ada's Spices", "ada@spices.com");
    expect(t).toContain("Terms of sale for Ada's Spices");
    expect(t).toContain("email us at ada@spices.com");
    expect(defaultTerms("", "")).toContain("get in touch with us");
    expect(termsPromptForSol("Ada")).toContain("Ada");
  });
  it("only accepts web links", () => {
    expect(termsUrlProblem("")).toBeNull();
    expect(termsUrlProblem("https://a.com/terms")).toBeNull();
    expect(termsUrlProblem("javascript:alert(1)")).toMatch(/https/);
    expect(termsUrlProblem("a.com")).toMatch(/https/);
  });
  it("hosts the text safely", () => {
    const html = renderTermsHtml("Ada <b>", "Terms for Ada\n\nReturns\nBring it <script>alert(1)</script> back");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<h1>Terms for Ada</h1>");
    expect(html).toContain("<h2>Returns</h2>");
    expect(html).toContain("Ada &lt;b&gt;");
  });
  it("is saved and returned by the settings code the dashboard and MCP share", () => {
    const { data, toRemove } = applyCheckoutSettingsInput({ termsText: " Be kind ", termsUrl: "" }, null);
    expect(data.termsText).toBe("Be kind");
    expect(toRemove).toContain("termsUrl");
    expect(() => applyCheckoutSettingsInput({ termsUrl: "ftp://x" }, null)).toThrow(CheckoutSettingsError);
    expect(() => applyCheckoutSettingsInput({ termsText: "x".repeat(10001) }, null)).toThrow(/too long/);
    expect(checkoutSettingsView({ termsText: "Hi", termsUrl: null } as never)).toMatchObject({ termsText: "Hi", termsUrl: null });
  });
  it("shows up as a link in the order email only when set", () => {
    const base = { event: "PAID" as const, siteName: "S", orderNumber: "1", amountFormatted: "N1", items: [], currency: "NGN", orderUrl: "https://s/o" };
    expect(buildOrderStatusEmail(base).html).not.toContain("terms of sale");
    expect(buildOrderStatusEmail({ ...base, termsUrl: "https://s/terms" }).html).toContain('href="https://s/terms"');
  });
});
