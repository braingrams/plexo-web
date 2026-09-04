import { randomUUID } from "node:crypto";

import { EmailLog } from "@/lib/db/opsEntities";

/**
 * One label per call site that sends an email — kept as a union (not a bare `string`) so
 * every call site is forced to pick from a known, deliberate set instead of drifting into
 * ad-hoc strings over time. Add a new value here whenever a new call site is wired in.
 */
export type EmailDeliveryContext =
  | "verification_email"
  | "password_reset"
  | "blog_comment_notification"
  | "comment_mention_notification"
  | "comment_reply_notification"
  | "site_transfer"
  | "invitation"
  | "form_submission"
  | "commerce_receipt"
  | "commerce_digital_delivery"
  | "commerce_payment_received"
  | "testimonial_notification"
  | "feedback_notification"
  | "withdrawal_request_notification"
  | "script_access_request_notification"
  | "commerce_stripe_access_request_notification"
  | "commerce_withdrawal_request_notification";

/**
 * Fire-and-forget write to EmailLog — mirrors this codebase's established
 * `void X.create(...).go().catch(...)` idiom (see e.g. PaystackWebhookEvent/StripeEvent
 * writers) so a DynamoDB hiccup while logging an email's outcome can never itself delay or
 * fail the request that triggered the send. Callers should call this on BOTH the success
 * and failure path of every real email send, right next to the existing
 * console.error/console.info for that send — this never replaces those, only supplements
 * them with a queryable record.
 */
export function logEmailDelivery(input: {
  kind: "maildrip" | "smtp";
  to: string;
  subject: string;
  status: "sent" | "failed";
  errorMessage?: string;
  context: EmailDeliveryContext;
  organizationId?: string;
  templateId?: string;
}): void {
  void EmailLog.create({
    id: randomUUID(),
    kind: input.kind,
    to: input.to,
    subject: input.subject,
    status: input.status,
    errorMessage: input.errorMessage,
    context: input.context,
    organizationId: input.organizationId,
    templateId: input.templateId,
  })
    .go()
    .catch((err) => console.error("Failed to write EmailLog:", err));
}
