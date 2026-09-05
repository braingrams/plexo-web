import { randomUUID } from "node:crypto";
import { dynamoAdapter } from "@/server/authDynamo";
import { LmsEnrollment, Template } from "@/lib/db/contentEntities";
import { sendMaildripEmail } from "@/lib/mail/maildrip";
import { buildLmsMagicLinkEmail } from "@/lib/mail/templates";
import { logEmailDelivery } from "@/lib/mail/logEmail";

type PaidOrderInput = {
  id: string;
  templateId: string;
  organizationId: string;
  customerEmail: string;
  customerName?: string;
};

const MAGIC_LINK_TTL_MS = 24 * 60 * 60 * 1000;

function isConditionalCheckFailure(err: unknown): boolean {
  const anyErr = err as { name?: string; cause?: { name?: string } };
  return anyErr?.name === "ConditionalCheckFailedException" || anyErr?.cause?.name === "ConditionalCheckFailedException";
}

/**
 * Creates a free enrollment (idempotent — signing up twice with the same email just
 * re-sends the magic link rather than erroring, since a visitor retrying a form after not
 * seeing the email is the common case, not a mistake to reject) and emails the login link.
 */
export async function createFreeEnrollment(
  templateId: string,
  organizationId: string,
  input: { email: string; name?: string; phone?: string },
): Promise<void> {
  const email = input.email.trim().toLowerCase();

  try {
    await LmsEnrollment.create({
      id: randomUUID(),
      templateId,
      organizationId,
      email,
      name: input.name?.trim() || undefined,
      phone: input.phone?.trim() || undefined,
    }).go();
  } catch (err) {
    if (!isConditionalCheckFailure(err)) throw err; // already enrolled — just resend the link
  }

  await sendMagicLinkEmail(templateId, email);
}

/**
 * Called from the Commerce order-paid webhook path (lib/db/commerceWebhookOperations.ts's
 * deliverDigitalProducts) when the paid item is a funnel's linked signup product — a paid
 * enrollment reuses Commerce's checkout/order infra wholesale rather than a parallel
 * payment system (see the Funnel/LMS plan's billing section 4b). Idempotent the same way
 * createFreeEnrollment is, since a webhook can retry.
 */
export async function activateLmsEnrollmentFromOrder(order: PaidOrderInput): Promise<void> {
  const email = order.customerEmail.trim().toLowerCase();

  try {
    await LmsEnrollment.create({
      id: randomUUID(),
      templateId: order.templateId,
      organizationId: order.organizationId,
      email,
      name: order.customerName?.trim() || undefined,
      paymentStatus: "PAID",
      commerceOrderId: order.id,
    }).go();
  } catch (err) {
    if (!isConditionalCheckFailure(err)) throw err; // already enrolled — webhook retry, just resend the link
  }

  await sendMagicLinkEmail(order.templateId, email);
}

/**
 * Issues a fresh single-use, expiring magic-link token via Auth.js's DynamoDB adapter (the
 * same createVerificationToken primitive app/api/auth/register/route.ts uses for dashboard-
 * user email verification, identifier-namespaced so it can never collide with that use),
 * and emails it. Reusable for both first signup and a returning visitor requesting a new
 * link (e.g. their cookie expired).
 */
export async function sendMagicLinkEmail(templateId: string, email: string): Promise<void> {
  const { data: site } = await Template.get({ id: templateId }).go();
  const funnelName = site?.name ?? "your funnel";

  const token = randomUUID();
  await dynamoAdapter.createVerificationToken?.({
    identifier: `lms-login:${templateId}:${email}`,
    token,
    expires: new Date(Date.now() + MAGIC_LINK_TTL_MS),
  });

  await LmsEnrollment.patch({ templateId, email }).set({ magicLinkLastSentAt: new Date().toISOString() }).go();

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const actionUrl = `${baseUrl}/api/public/lms/${templateId}/magic-link/verify?token=${token}&email=${encodeURIComponent(email)}`;
  const subject = `Your link to ${funnelName}`;

  try {
    await sendMaildripEmail({ to: email, subject, html: buildLmsMagicLinkEmail(funnelName, actionUrl) });
    logEmailDelivery({ kind: "maildrip", to: email, subject, status: "sent", context: "lms_magic_link", templateId });
  } catch (err) {
    console.error("Failed to send LMS magic-link email:", err);
    logEmailDelivery({
      kind: "maildrip", to: email, subject, status: "failed",
      errorMessage: err instanceof Error ? err.message : String(err), context: "lms_magic_link", templateId,
    });
    throw err;
  }
}
