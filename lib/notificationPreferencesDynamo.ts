import { NotificationPreferences } from "@/lib/db/coreEntities";

// DynamoDB twin of lib/notificationPreferences.ts. Only app/api/v1/comments/route.ts is
// repointed here for now — app/api/blog-comments/route.ts,
// app/api/public/forms/[templateId]/submit/route.ts, and the (per the cutover checklist,
// already-orphaned) old lib/commerce/{digitalDelivery,orderFulfillment}.ts are outside this
// pass's scope and stay on the Prisma original until their own bounded context's cutover.

export type NotificationType = "formSubmissions" | "blogComments" | "payments" | "commentMentions";

async function loadPreferences(
  organizationId: string,
): Promise<{ formSubmissions: boolean; blogComments: boolean; payments: boolean; commentMentions: boolean; notificationEmail?: string } | null> {
  const { data } = await NotificationPreferences.get({ organizationId }).go();
  if (!data) return null;
  return {
    formSubmissions: data.formSubmissions ?? false,
    blogComments: data.blogComments ?? true,
    payments: data.payments ?? true,
    commentMentions: data.commentMentions ?? true,
    notificationEmail: data.notificationEmail,
  };
}

/** A missing NotificationPreferences row (the common case; most orgs never visit the
 * settings toggle) means every type's own schema default applies, not "notifications off." */
function isEnabled(prefs: Awaited<ReturnType<typeof loadPreferences>>, type: NotificationType): boolean {
  return prefs ? prefs[type] : type !== "formSubmissions"; // mirrors each field's own default in coreEntities.ts
}

/**
 * For "notify the site's shared inbox" cases (a form was submitted, a blog got a comment,
 * a payment came in) — resolves both whether to send AND where, honoring the org's
 * notificationEmail override when set.
 */
export async function resolveNotificationRecipient(
  organizationId: string,
  type: NotificationType,
  fallbackEmail: string | null | undefined,
): Promise<string | null> {
  const prefs = await loadPreferences(organizationId);
  if (!isEnabled(prefs, type)) return null;
  const to = prefs?.notificationEmail || fallbackEmail;
  return to || null;
}

/**
 * For "notify this specific person" cases (an @mention) — the recipient is fixed, so only
 * the on/off gate applies; the org's notificationEmail override has no business redirecting
 * someone else's personal mention notice to a shared inbox.
 */
export async function isNotificationEnabled(organizationId: string, type: NotificationType): Promise<boolean> {
  return isEnabled(await loadPreferences(organizationId), type);
}
