import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Every transactional email renders with the new Plexo brand: PNG logo, one lime call to action, no old purple,
// and dark-mode support. Set EMAIL_PREVIEW_DIR to also write each one out as an .html file to look at.
const sent: { subject: string; html: string }[] = [];
vi.mock("@/lib/admin/alertRecipients", () => ({ adminAlertRecipients: async () => ["team@example.com"] }));
vi.mock("@/lib/mail/logEmail", () => ({ logEmailDelivery: () => {} }));
vi.mock("@/lib/mail/maildrip", async (orig) => ({
  ...(await orig<typeof import("@/lib/mail/maildrip")>()),
  sendMaildripEmail: async (m: { subject: string; html: string }) => void sent.push(m),
}));

import * as T from "@/lib/mail/templates";
import { emailShell } from "@/lib/mail/maildrip";

const U = "https://plexo.charisol.io/x";
const rendered: Record<string, string> = {};
const add = (name: string, v: string | { html: string }) => void (rendered[name] = typeof v === "string" ? v : v.html);
const PURPLE = /#(8b5cf6|7c3aed|6d28d9|a78bfa|6b3bf9|5b2be6|c084fc|ede9fe|818cf8)\b/i;
const brand = { name: "Acme Studio", color: "#E11D48", logoUrl: "https://cdn.example.com/acme.png" };

beforeAll(async () => {
  add("verification", T.buildVerificationEmail(U));
  add("password-reset", T.buildPasswordResetEmail(U));
  add("lms-magic-link", T.buildLmsMagicLinkEmail("Course", U));
  add("lms-drip-ready", T.buildLmsDripReadyEmail("Course", "Lesson 2", U));
  add("invite", T.buildInviteEmail({ inviterName: "Ada", orgName: "Acme", role: "editor", acceptUrl: U }));
  add("invite-whitelabel", T.buildInviteEmail({ inviterName: "Ada", orgName: "Acme", role: "editor", acceptUrl: U, brand }));
  add("site-transfer", T.buildSiteTransferEmail({ senderName: "Ada", siteName: "Shop", acceptUrl: U, warningCount: 2, expiresInDays: 7 }));
  add("mention", T.buildMentionEmail({ mentionerName: "Ada", templateName: "Home", commentSnippet: "Looks great", deepLinkUrl: U }));
  add("blog-comment", T.buildNewBlogCommentEmail({ commenterName: "Bo", postTitle: "Hello", commentSnippet: "Nice", moderationUrl: U }));
  add("comment-reply", T.buildCommentReplyEmail({ replierName: "Ada", templateName: "Home", commentSnippet: "Thanks", deepLinkUrl: U }));
  add("form-submission", T.buildFormSubmissionEmail({ siteName: "Shop", formName: "Contact", fieldsPreview: [["Name", "Bo"]], submissionsUrl: U }));
  add("payment-received", T.buildPaymentReceivedEmail({ siteName: "Shop", amountFormatted: "$20.00", customerEmail: "a@b.co", orderNumber: "1001", orderUrl: U }));
  for (const event of ["PAID", "PROCESSING", "READY_FOR_PICKUP", "SHIPPED", "COMPLETED", "REFUNDED"] as const)
    add(`order-${event.toLowerCase()}`, T.buildOrderStatusEmail({ event, siteName: "Shop", orderNumber: "1001", amountFormatted: "$20.00", items: [{ nameSnapshot: "Mug", quantity: 1, unitPriceMinor: 2000 }], currency: "USD", orderUrl: U }));
  add("bank-owner", T.buildBankTransferOwnerEmail({ siteName: "Shop", amountFormatted: "$20", orderNumber: "1", customerName: "Bo", customerEmail: "a@b.co", details: [["Ref", "1"]], confirmUrl: U }));
  add("bank-customer", T.buildBankTransferCustomerEmail({ siteName: "Shop", amountFormatted: "$20", orderNumber: "1", bankRows: [["Bank", "X"]], instructions: "Pay soon", orderUrl: U }));
  add("bank-rejected", T.buildBankTransferRejectedEmail({ siteName: "Shop", orderNumber: "1", amountFormatted: "$20", reason: "No match", storeUrl: U }));
  add("digital-file", T.buildDigitalFileDeliveryEmail({ siteName: "Shop", productName: "Guide", downloadUrl: U }));
  add("digital-link", T.buildDigitalExternalLinkEmail({ siteName: "Shop", productName: "Guide", accessUrl: U }));
  add("digital-access", T.buildDigitalAccessGrantedEmail({ siteName: "Shop", productName: "Guide", accessInstructions: "Log in", password: "pw", accessUrl: U }));
  add("domain-transfer-code", T.buildDomainTransferCodeEmail({ domain: "a.com", authCode: "XYZ" }));
  add("domain-renewal-failed", T.buildDomainRenewalFailedEmail({ domain: "a.com", renewalPriceFormatted: "$12", manageUrl: U }));
  add("donation-receipt", T.buildDonationReceiptEmail({ siteName: "Charity", donorName: "Bo", amountFormatted: "$10", monthly: true, campaignName: null, receiptNumber: "D1", dateIso: "2026-01-01", thankYouMessage: null, manageUrl: U }));
  add("wp-done", T.buildWpMigrationDoneEmail({ siteName: "Blog", pagesCopied: 4, postsCopied: 20, thingsToCheck: 2, reportUrl: U }));
  add("wp-paused", T.buildWpMigrationPausedEmail({ siteName: "Blog", reason: "host was slow", resumeUrl: U }));
  add("plan-ending", T.buildPlanEndingSoonEmail({ plan: "PRO", endsAt: "2026-12-01", kind: "TRIAL", stage: "WEEK", upgradeUrl: U }));
  add("plan-renewal", T.buildPlanRenewalSoonEmail({ plan: "PRO", renewsAt: "2026-12-01", amountMinor: 2000, currency: "USD", manageUrl: U }));
  add("payment-declined", T.buildPaymentDeclinedEmail({ plan: "PRO", amountMinor: 2000, currency: "USD", manageUrl: U }));
  add("plan-ended", T.buildPlanEndedEmail({ previousPlan: "PRO", reason: "TRIAL_ENDED", liveSiteName: "Shop", liveAddress: "shop.plexo.site", offlineSiteCount: 1, archivedPageCount: 2, customDomainCount: 1, upgradeUrl: U }));
  add("payment-receipt", T.buildPaymentReceiptEmail({ receiptNumber: "R-1", name: "Ada Lovelace", description: "Pro plan", detail: "Monthly", amountCents: 2000, refundedCents: 0, currency: "USD", paidAt: "2026-01-01T00:00:00Z", card: { brand: "visa", last4: "4242" }, downloadUrl: U, historyUrl: U }));
  add("redesign-announcement", T.buildRedesignAnnouncementEmail({ name: "Ada Lovelace", setupUrl: U, unsubscribeUrl: U }));
  add("shell-whitelabel-no-logo", emailShell({ title: "x", bodyHtml: T.CTA_BUTTON(U, "Go", "#E11D48"), brand: { name: "Acme", color: "#E11D48" } }));

  // Admin notifications (lib/email.ts) and app sign-in emails (lib/appAuth/emails.ts) go out through a mocked sender.
  const E = await import("@/lib/email");
  await E.sendTestimonialNotificationEmail({ id: "t1", name: "Bo", role: "CEO", company: "Co", quote: "Great", rating: 5 });
  await E.sendFeedbackNotificationEmail({ userName: "Bo", userEmail: "a@b.co", message: "Nice", pageUrl: null });
  await E.sendWithdrawalRequestNotificationEmail({ id: "w", userEmail: "a@b.co", userName: "Bo", amountCents: 1000, bankName: "Bank" });
  await E.sendScriptAccessRequestNotificationEmail({ id: "s", userEmail: "a@b.co", userName: "Bo", templateId: "t", templateName: "T", reason: null });
  await E.sendCommerceStripeAccessRequestNotificationEmail({ id: "c", organizationName: "S", userEmail: "a@b.co", userName: "Bo" });
  await E.sendCommerceWithdrawalRequestNotificationEmail({ id: "cw", organizationName: "S", userEmail: "a@b.co", userName: "Bo", amountCents: 500, currency: "usd", bankName: "Bank" });
  sent.forEach((m, i) => add(`admin-notification-${i + 1}`, m.html));
  sent.length = 0;
  const A = await import("@/lib/appAuth/emails");
  const ctx = { appName: "Acme App", settings: { emailFromName: "" }, organizationId: "o", templateId: "t" } as never;
  await A.sendMagicLinkEmail(ctx, "a@b.co", U);
  await A.sendVerifyEmail(ctx, "a@b.co", U);
  await A.sendResetEmail(ctx, "a@b.co", U);
  await A.sendInviteEmail(ctx, "a@b.co", U);
  sent.forEach((m, i) => add(`app-auth-${i + 1}`, m.html));

  const dir = process.env.EMAIL_PREVIEW_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    for (const [name, html] of Object.entries(rendered)) writeFileSync(path.join(dir, `${name}.html`), html);
  }
});

describe("transactional emails use the new Plexo brand", () => {
  it("renders a decent number of emails", () => {
    expect(Object.keys(rendered).length).toBeGreaterThan(40);
  });

  it("every email has a logo, dark-mode support, and no purple", () => {
    for (const [name, html] of Object.entries(rendered)) {
      if (!/no-logo|^app-auth/.test(name)) expect(html, name).toMatch(/<img [^>]*src="https?:\/\/[^"]+(\.(png|jpg|jpeg|webp)|\/api\/brand\/logo\/email-on-light)"/i);
      expect(html, name).toContain("prefers-color-scheme: dark");
      expect(html, name).toContain('name="color-scheme"');
      expect(html, name).not.toMatch(PURPLE);
      expect(html, name).not.toMatch(/<svg[\s>]/i); // Gmail can't show SVG
    }
  });

  it("the logo is centred at the top of every email (Outlook-safe)", () => {
    for (const [name, html] of Object.entries(rendered)) {
      expect(html, name).toMatch(/<td align="center" style="[^"]*text-align:center;">\s*(<img|<table align="center")/);
    }
  });

  it("Plexo emails show the Plexo wordmark PNG; white-label emails keep the org logo", () => {
    expect(rendered["verification"]).toContain("/api/brand/logo/email-on-light");
    expect(rendered["verification"]).toContain("/api/brand/logo/email-on-dark");
    expect(rendered["invite-whitelabel"]).toContain("https://cdn.example.com/acme.png");
    expect(rendered["invite-whitelabel"]).not.toContain("plexo-wordmark");
  });

  it("every email that asks the reader to act has one bulletproof (Outlook-safe) button", () => {
    for (const [name, html] of Object.entries(rendered)) {
      if (/domain-transfer-code|digital-link|admin-notification|plan-ended|digital-access|donation-receipt/.test(name) && !html.includes(`class="em-btn"`)) continue; // information-only emails
      expect(html, name).toMatch(/v:roundrect/);
      expect(html, name).toContain('class="em-btn"');
    }
  });

  it("the lime button uses dark text; the announcement is complete", () => {
    expect(rendered["verification"]).toContain("background:#B8F34A");
    expect(rendered["verification"]).toMatch(/class="em-btn"[^>]*color:#111111/);
    const a = rendered["redesign-announcement"];
    expect(a).toContain("Take 1 minute to personalise");
    expect(a).toContain(`href="${U}"`);
    for (const w of ["simpler dashboard", "Guided setup", "tours", "Light or dark"]) expect(a.toLowerCase()).toContain(w.toLowerCase().replace("friendly ", ""));
    expect(a).toContain("Unsubscribe");
  });

  it("the announcement subject is right", () => {
    expect(T.buildRedesignAnnouncementEmail({ setupUrl: U }).subject).toBe("Plexo has a new look — personalise your experience");
  });
});
