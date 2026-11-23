import { randomUUID } from "node:crypto";
import { resolveNotificationRecipient } from "@/lib/notificationPreferencesDynamo";
import { sendMaildripEmail } from "@/lib/mail/maildrip";
import { buildFormSubmissionEmail } from "@/lib/mail/templates";
import { logEmailDelivery } from "@/lib/mail/logEmail";
import { FormSubmission } from "@/lib/db/opsEntities";
import { runFormActions } from "@/lib/forms/formActions";
import { isTechnicalField, visibleFields } from "@/lib/forms/technicalFields";
import { isCertainSpam, isLikelySpam } from "@/lib/forms/spamHeuristics";
import { Template } from "@/lib/db/contentEntities";
import { User } from "@/lib/db/coreEntities";

// The one place a website form submission is stored and the owner notified — shared by the
// native form endpoint (app/api/public/forms/[templateId]/submit) and the capture of
// submissions a migrated WordPress plugin's own JavaScript still sends (see
// app/pub/[domain]/[[...slug]]/route.ts's POST handler), so both land in the same
// Form Submissions inbox with the same email.

const MAX_FIELD_LENGTH = 5000;

/**
 * Flattens submitted entries into the stored field map. A field that appears more than
 * once — a checkbox group ("interests[]"), a multi-select — keeps EVERY value, joined
 * with ", ", instead of silently keeping only the last one. The "[]" array suffix PHP-era
 * form markup uses is dropped from the stored name.
 */
export function collectFormFields(entries: Iterable<[string, unknown]>): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [rawKey, value] of entries) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = rawKey.replace(/\[\]$/, "").trim();
    if (!key) continue;
    fields[key] = (fields[key] ? `${fields[key]}, ${trimmed}` : trimmed).slice(0, MAX_FIELD_LENGTH);
  }
  return fields;
}

export async function recordFormSubmission(input: {
  templateId: string;
  organizationId: string;
  formName: string;
  fields: Record<string, string>;
  submitterIp?: string | null;
  /** The site's address, passed on to a webhook. */
  siteHost?: string | null;
}): Promise<void> {
  // Spam we are sure about (a machine call, keyboard-mash, a pile of links, a link with a sales pitch) is dropped before anything is
  // stored or emailed. The visitor-facing answer stays the same, so a spammer gets no signal to adapt to.
  if (isCertainSpam(Object.fromEntries(visibleFields(input.fields)))) return;
  // Only what the visitor wrote: verification answers and spam-detector readings are not part of their message.
  const fields = Object.fromEntries(Object.entries(input.fields).filter(([k]) => !isTechnicalField(k)));
  await FormSubmission.create({
    id: randomUUID(),
    templateId: input.templateId,
    organizationId: input.organizationId,
    formName: input.formName,
    fields,
    submitterIp: input.submitterIp ?? undefined,
  }).go();

  // Awaited, not fired and forgotten: on a serverless server the work stops the moment the answer is sent, so an email started
  // "in the background" was sometimes never sent. A mail problem is logged but never stops the visitor's message being received.
  // Anything still suspicious stays in the inbox, marked "Likely spam", but is not emailed: the owner's inbox is for people.
  if (!isLikelySpam(fields)) {
    await notifyFormSubmission(input.templateId, input.organizationId, input.formName, fields).catch((err) =>
      console.error("[mail] form submission notification failed:", err),
    );
  }
  // MailDrip list / webhook, when the owner set them up for this form (lib/forms/formActions.ts).
  await runFormActions({ templateId: input.templateId, formName: input.formName, fields, siteHost: input.siteHost });
}

async function notifyFormSubmission(
  templateId: string,
  organizationId: string,
  formName: string,
  fields: Record<string, string>,
): Promise<void> {
  const { data: template } = await Template.get({ id: templateId }).go();
  if (!template) return;
  const { data: owner } = await User.get({ id: template.userId }).go();

  const to = await resolveNotificationRecipient(organizationId, "formSubmissions", owner?.email);
  if (!to) return;

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const html = buildFormSubmissionEmail({
    siteName: template.name,
    formName,
    fieldsPreview: visibleFields(fields).slice(0, 8),
    submissionsUrl: `${base}/dashboard/templates/${templateId}/form-submissions`,
  });
  const subject = `New ${formName} submission on ${template.name}`;
  try {
    await sendMaildripEmail({ to, subject, html });
    logEmailDelivery({ kind: "maildrip", to, subject, status: "sent", context: "form_submission", organizationId, templateId });
  } catch (err) {
    logEmailDelivery({
      kind: "maildrip", to, subject, status: "failed",
      errorMessage: err instanceof Error ? err.message : String(err),
      context: "form_submission", organizationId, templateId,
    });
    throw err;
  }
}
