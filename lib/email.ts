import nodemailer from "nodemailer";
import { createHmac } from "node:crypto";

import { emailShell } from "@/lib/mail/maildrip";
import { CTA_BUTTON } from "@/lib/mail/templates";

/**
 * Every admin-notification email below goes through emailShell (logo at top, same card/
 * spacing/typography as every customer-facing email — verification, invites, mentions,
 * etc.) instead of each function carrying its own hand-rolled <!DOCTYPE html>/<style> block.
 * Previously these used a separate dark theme with no logo at all, so an admin's inbox had
 * two visually unrelated "kinds" of Plexo email — this puts everything on the one shared
 * template. No `brand` override is ever passed here: these go to ADMIN_EMAIL (Charisol
 * staff), never a customer, so there's no white-labeling concept to apply — always the
 * real Plexo mark.
 */

const MODERATION_SECRET = process.env.MODERATION_SECRET || process.env.AI_KEY_ENCRYPTION_SECRET || "plexo_testimonial_moderation_secret_key";

/**
 * Generates a HMAC-SHA256 token for 1-click email moderation link security.
 */
export function generateModerationToken(id: string, action: "approve" | "reject"): string {
  return createHmac("sha256", MODERATION_SECRET)
    .update(`${id}:${action}`)
    .digest("hex");
}

/**
 * Validates a moderation token against testimonial id and action.
 */
export function verifyModerationToken(id: string, action: "approve" | "reject", token: string): boolean {
  const expected = generateModerationToken(id, action);
  return expected === token;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function badge(label: string, bg: string, color: string): string {
  return `<span style="display:inline-block;background:${bg};color:${color};font-size:12px;font-weight:700;padding:6px 14px;border-radius:9999px;letter-spacing:0.3px;text-transform:uppercase;margin-bottom:20px;">${label}</span>`;
}

function detailsBlock(rows: string): string {
  return `<div style="margin:20px 0;padding:16px 20px;background:#f1f5f9;border-radius:10px;text-align:left;font-size:14px;color:#334155;line-height:1.8;">${rows}</div>`;
}

function detailRow(label: string, value: string): string {
  return `<p style="margin:0;"><strong style="color:#0f172a;">${label}:</strong> ${value}</p>`;
}

function twoButtonRow(
  leftHref: string, leftLabel: string, leftColor: string,
  rightHref: string, rightLabel: string, rightColor: string,
): string {
  return `
  <table align="center" cellpadding="0" cellspacing="0" style="margin:0 auto 24px auto;">
    <tr>
      <td style="padding:0 6px;">
        <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:${leftColor};">
          <a href="${leftHref}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">${leftLabel}</a>
        </td></tr></table>
      </td>
      <td style="padding:0 6px;">
        <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:${rightColor};">
          <a href="${rightHref}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">${rightLabel}</a>
        </td></tr></table>
      </td>
    </tr>
  </table>`;
}

async function deliver(params: { to: string; subject: string; html: string; logLabel: string; logLines: string[] }): Promise<void> {
  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: process.env.SMTP_FROM || `"Plexo Notifications" <noreply@plexopages.com>`,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });
  } else {
    console.log("--------------------------------------------------");
    console.log(`[${params.logLabel}]`);
    console.log(`To: ${params.to}`);
    for (const line of params.logLines) console.log(line);
    console.log("--------------------------------------------------");
  }
}

export type SendTestimonialEmailParams = {
  id: string;
  name: string;
  role: string;
  company?: string | null;
  quote: string;
  rating: number;
  avatarUrl?: string | null;
};

/**
 * Sends a notification email to ADMIN_EMAIL with 1-click Approval & Rejection links.
 */
export async function sendTestimonialNotificationEmail(testimonial: SendTestimonialEmailParams) {
  const adminEmail = process.env.ADMIN_EMAIL || process.env.SMTP_FROM || "admin@plexopages.com";
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const approveToken = generateModerationToken(testimonial.id, "approve");
  const rejectToken = generateModerationToken(testimonial.id, "reject");
  const approveUrl = `${baseUrl}/api/testimonials/moderate?id=${testimonial.id}&action=approve&token=${approveToken}`;
  const rejectUrl = `${baseUrl}/api/testimonials/moderate?id=${testimonial.id}&action=reject&token=${rejectToken}`;

  const html = emailShell({
    title: "New Testimonial Submitted",
    bodyHtml: `
      ${badge("New Testimonial Submitted", "#ede9fe", "#7c3aed")}
      <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;text-align:center;">A new review requires your approval</h1>
      <p style="margin:0 0 8px;font-size:15px;color:#334155;line-height:1.6;font-style:italic;background:#f1f5f9;border-radius:10px;padding:16px 20px;text-align:left;">
        &ldquo;${escapeHtml(testimonial.quote)}&rdquo;
      </p>
      ${detailsBlock([
        detailRow("Author", escapeHtml(testimonial.name)),
        detailRow("Role &amp; Company", `${escapeHtml(testimonial.role)}${testimonial.company ? ` at ${escapeHtml(testimonial.company)}` : ""}`),
        detailRow("Rating", `${"&#9733;".repeat(testimonial.rating)} (${testimonial.rating}/5)`),
        testimonial.avatarUrl ? detailRow("Avatar URL", `<a href="${escapeHtml(testimonial.avatarUrl)}" style="color:#7c3aed;">${escapeHtml(testimonial.avatarUrl)}</a>`) : "",
      ].filter(Boolean).join(""))}
      ${twoButtonRow(approveUrl, "Approve & Publish", "#10b981", rejectUrl, "Reject", "#ef4444")}
    `,
  });

  await deliver({
    to: adminEmail,
    subject: `[Plexo Review] New Testimonial from ${testimonial.name}`,
    html,
    logLabel: "TESTIMONIAL EMAIL NOTIFICATION LOG",
    logLines: [`Approve Link: ${approveUrl}`, `Reject Link: ${rejectUrl}`],
  });
}

export type SendFeedbackEmailParams = {
  userName: string;
  userEmail: string;
  message: string;
  pageUrl?: string | null;
};

/**
 * Notifies ADMIN_EMAIL that new product feedback was submitted. No 1-click links — there's
 * no action to take from the email, just a heads-up; triage happens in plexo-admin's
 * Feedback queue.
 */
export async function sendFeedbackNotificationEmail(feedback: SendFeedbackEmailParams) {
  const adminEmail = process.env.ADMIN_EMAIL || process.env.SMTP_FROM || "admin@plexopages.com";

  const html = emailShell({
    title: "New Feedback",
    bodyHtml: `
      ${badge("New Feedback", "#ede9fe", "#7c3aed")}
      <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;text-align:center;">A user submitted feedback</h1>
      ${detailsBlock([
        detailRow("From", `${escapeHtml(feedback.userName)} (${escapeHtml(feedback.userEmail)})`),
        feedback.pageUrl ? detailRow("Page", escapeHtml(feedback.pageUrl)) : "",
      ].filter(Boolean).join(""))}
      <p style="margin:0;font-size:14px;color:#334155;line-height:1.6;white-space:pre-wrap;background:#f1f5f9;border-radius:10px;padding:16px 20px;text-align:left;">${escapeHtml(feedback.message)}</p>
    `,
  });

  await deliver({
    to: adminEmail,
    subject: `[Plexo Feedback] New feedback from ${feedback.userName}`,
    html,
    logLabel: "FEEDBACK EMAIL NOTIFICATION LOG",
    logLines: [`From: ${feedback.userName} (${feedback.userEmail})`, `Message: ${feedback.message}`],
  });
}

export type SendWithdrawalRequestEmailParams = {
  id: string;
  userEmail: string;
  userName: string;
  amountCents: number;
  bankName: string;
};

/**
 * Notifies ADMIN_EMAIL that a new withdrawal request needs review. Unlike
 * sendTestimonialNotificationEmail, there's no 1-click approve/reject link — processing a
 * payout requires typing a reason on rejection, so it has to go through plexo-admin's own
 * review UI, not a single GET request.
 */
export async function sendWithdrawalRequestNotificationEmail(withdrawal: SendWithdrawalRequestEmailParams) {
  const adminEmail = process.env.ADMIN_EMAIL || process.env.SMTP_FROM || "admin@plexopages.com";
  const adminAppUrl = process.env.ADMIN_APP_URL || "http://localhost:3001";
  const reviewUrl = `${adminAppUrl}/withdrawals`;
  const amount = (withdrawal.amountCents / 100).toFixed(2);

  const html = emailShell({
    title: "New Withdrawal Request",
    bodyHtml: `
      ${badge("New Withdrawal Request", "#ede9fe", "#7c3aed")}
      <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;text-align:center;">A seller has requested a payout</h1>
      ${detailsBlock([
        detailRow("Requested by", `${escapeHtml(withdrawal.userName)} (${escapeHtml(withdrawal.userEmail)})`),
        detailRow("Amount", `$${amount}`),
        detailRow("Bank", escapeHtml(withdrawal.bankName)),
      ].join(""))}
      ${CTA_BUTTON(reviewUrl, "Review in Admin")}
    `,
  });

  await deliver({
    to: adminEmail,
    subject: `[Plexo Payout] Withdrawal requested by ${withdrawal.userName}`,
    html,
    logLabel: "WITHDRAWAL REQUEST EMAIL NOTIFICATION LOG",
    logLines: [`Requested by: ${withdrawal.userName} (${withdrawal.userEmail})`, `Amount: $${amount}`, `Review: ${reviewUrl}`],
  });
}

export type SendScriptAccessRequestEmailParams = {
  id: string;
  userEmail: string;
  userName: string;
  templateId: string;
  templateName: string;
  reason?: string | null;
};

/**
 * Notifies ADMIN_EMAIL that a user wants full-script (unsandboxed) preview access for a
 * RAW_UPLOAD template's Text Content tab. Like withdrawals, there's no 1-click link —
 * approving requires staff to pick a duration, so it goes through plexo-admin's review UI.
 */
export async function sendScriptAccessRequestNotificationEmail(req: SendScriptAccessRequestEmailParams) {
  const adminEmail = process.env.ADMIN_EMAIL || process.env.SMTP_FROM || "admin@plexopages.com";
  const adminAppUrl = process.env.ADMIN_APP_URL || "http://localhost:3001";
  const reviewUrl = `${adminAppUrl}/script-access-requests`;

  const html = emailShell({
    title: "Full Script Preview Requested",
    bodyHtml: `
      ${badge("Full Script Preview Requested", "#ede9fe", "#7c3aed")}
      <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;text-align:center;">A user wants scripts enabled in their template preview</h1>
      ${detailsBlock([
        detailRow("Requested by", `${escapeHtml(req.userName)} (${escapeHtml(req.userEmail)})`),
        detailRow("Template", escapeHtml(req.templateName)),
        req.reason ? detailRow("Reason", escapeHtml(req.reason)) : "",
      ].filter(Boolean).join(""))}
      ${CTA_BUTTON(reviewUrl, "Review in Admin")}
    `,
  });

  await deliver({
    to: adminEmail,
    subject: `[Plexo] Full script preview requested — ${req.templateName}`,
    html,
    logLabel: "SCRIPT ACCESS REQUEST EMAIL NOTIFICATION LOG",
    logLines: [
      `Requested by: ${req.userName} (${req.userEmail})`,
      `Template: ${req.templateName} (${req.templateId})`,
      ...(req.reason ? [`Reason: ${req.reason}`] : []),
      `Review: ${reviewUrl}`,
    ],
  });
}

export type SendCommerceStripeAccessRequestEmailParams = {
  id: string;
  organizationName: string;
  userEmail: string;
  userName: string;
  reason?: string | null;
  expectedVolume?: string | null;
};

/** Notifies ADMIN_EMAIL that an org wants platform-hosted Stripe unlocked for Commerce —
 * same "no 1-click link, goes through plexo-admin's own review UI" shape as
 * sendScriptAccessRequestNotificationEmail/sendWithdrawalRequestNotificationEmail above. */
export async function sendCommerceStripeAccessRequestNotificationEmail(req: SendCommerceStripeAccessRequestEmailParams) {
  const adminEmail = process.env.ADMIN_EMAIL || process.env.SMTP_FROM || "admin@plexopages.com";
  const adminAppUrl = process.env.ADMIN_APP_URL || "http://localhost:3001";
  const reviewUrl = `${adminAppUrl}/commerce-stripe-access-requests`;

  const html = emailShell({
    title: "Platform Stripe Requested",
    bodyHtml: `
      ${badge("Platform Stripe Requested", "#ede9fe", "#7c3aed")}
      <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;text-align:center;">An org wants platform-hosted Stripe for Commerce</h1>
      ${detailsBlock([
        detailRow("Organization", escapeHtml(req.organizationName)),
        detailRow("Requested by", `${escapeHtml(req.userName)} (${escapeHtml(req.userEmail)})`),
        req.reason ? detailRow("Reason", escapeHtml(req.reason)) : "",
        req.expectedVolume ? detailRow("Expected volume", escapeHtml(req.expectedVolume)) : "",
      ].filter(Boolean).join(""))}
      ${CTA_BUTTON(reviewUrl, "Review in Admin")}
    `,
  });

  await deliver({
    to: adminEmail,
    subject: `[Plexo Commerce] Platform Stripe requested — ${req.organizationName}`,
    html,
    logLabel: "COMMERCE STRIPE ACCESS REQUEST EMAIL NOTIFICATION LOG",
    logLines: [
      `Organization: ${req.organizationName}`,
      `Requested by: ${req.userName} (${req.userEmail})`,
      ...(req.reason ? [`Reason: ${req.reason}`] : []),
      `Review: ${reviewUrl}`,
    ],
  });
}

export type SendCommerceWithdrawalRequestEmailParams = {
  id: string;
  organizationName: string;
  userEmail: string;
  userName: string;
  amountCents: number;
  bankName: string;
};

/** Notifies ADMIN_EMAIL that a Commerce wallet withdrawal needs review — same shape as
 * sendWithdrawalRequestNotificationEmail above (the marketplace's own equivalent), just
 * against CommerceWithdrawalRequest instead of WithdrawalRequest. */
export async function sendCommerceWithdrawalRequestNotificationEmail(req: SendCommerceWithdrawalRequestEmailParams) {
  const adminEmail = process.env.ADMIN_EMAIL || process.env.SMTP_FROM || "admin@plexopages.com";
  const adminAppUrl = process.env.ADMIN_APP_URL || "http://localhost:3001";
  const reviewUrl = `${adminAppUrl}/commerce-withdrawals`;
  const amount = (req.amountCents / 100).toFixed(2);

  const html = emailShell({
    title: "New Commerce Withdrawal Request",
    bodyHtml: `
      ${badge("New Commerce Withdrawal Request", "#ede9fe", "#7c3aed")}
      <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;text-align:center;">A Commerce wallet payout has been requested</h1>
      ${detailsBlock([
        detailRow("Organization", escapeHtml(req.organizationName)),
        detailRow("Requested by", `${escapeHtml(req.userName)} (${escapeHtml(req.userEmail)})`),
        detailRow("Amount", `₦${amount}`),
        detailRow("Bank", escapeHtml(req.bankName)),
      ].join(""))}
      ${CTA_BUTTON(reviewUrl, "Review in Admin")}
    `,
  });

  await deliver({
    to: adminEmail,
    subject: `[Plexo Commerce] Withdrawal requested by ${req.organizationName}`,
    html,
    logLabel: "COMMERCE WITHDRAWAL REQUEST EMAIL NOTIFICATION LOG",
    logLines: [
      `Organization: ${req.organizationName}`,
      `Requested by: ${req.userName} (${req.userEmail})`,
      `Amount: ₦${amount}`,
      `Review: ${reviewUrl}`,
    ],
  });
}
