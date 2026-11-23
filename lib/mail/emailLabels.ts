import type { EmailDeliveryContext } from "./logEmail";

const LABELS: Record<EmailDeliveryContext, string> = {
  verification_email: "Confirm your email",
  password_reset: "Password reset",
  blog_comment_notification: "New blog comment",
  comment_mention_notification: "You were mentioned",
  comment_reply_notification: "Reply to your comment",
  site_transfer: "Site handed over",
  invitation: "Team invitation",
  form_submission: "Someone filled in your form",
  commerce_receipt: "Customer receipt",
  commerce_order_status: "Order update",
  commerce_digital_delivery: "Download delivered",
  commerce_payment_received: "Payment received",
  commerce_donation_receipt: "Donation receipt",
  testimonial_notification: "New testimonial",
  feedback_notification: "New feedback",
  withdrawal_request_notification: "Withdrawal request",
  script_access_request_notification: "Script access request",
  commerce_stripe_access_request_notification: "Card payments request",
  commerce_withdrawal_request_notification: "Withdrawal request",
  domain_transfer_code: "Domain transfer code",
  domain_renewal_failed: "Domain renewal problem",
  lms_magic_link: "Course sign-in link",
  lms_enrollment_confirmation: "Course enrolment",
  lms_drip_ready: "New lesson ready",
  commerce_bank_transfer: "Bank transfer details",
  app_auth: "App sign-in",
  app_function_email: "Email from your app",
  plan_lifecycle: "Plan reminder",
};

/** What an email was for, in the words an owner would use. */
export function emailLabel(context: string): string {
  return (LABELS as Record<string, string>)[context] ?? context.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** A plain next step for a failed send. The raw provider message stays available underneath. */
export function failureHelp(errorMessage?: string | null): string {
  const m = (errorMessage ?? "").toLowerCase();
  if (/invalid.*(address|recipient|email)|no such user|mailbox|does not exist|unroutable/.test(m)) return "The address looks wrong or no longer exists. Check how it was typed.";
  if (/bounce|reject|blocked|spam|blacklist/.test(m)) return "The other side turned it away. Ask them to check their spam folder or use a different address.";
  if (/timeout|timed out|econn|network|unavailable|5\d\d/.test(m)) return "Our email service had a hiccup. It usually works if you do the same thing again.";
  return "We couldn't send this one. Try again, and contact us if it keeps happening.";
}

export type EmailStats = { total: number; sent: number; failed: number; last7: number; failed7: number };

export function summarizeEmails(rows: Array<{ status: "sent" | "failed"; createdAt: string }>, now = Date.now()): EmailStats {
  const week = now - 7 * 86_400_000;
  const s: EmailStats = { total: rows.length, sent: 0, failed: 0, last7: 0, failed7: 0 };
  for (const r of rows) {
    r.status === "sent" ? s.sent++ : s.failed++;
    if (r.createdAt && new Date(r.createdAt).getTime() >= week) { s.last7++; if (r.status === "failed") s.failed7++; }
  }
  return s;
}
