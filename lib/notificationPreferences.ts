import { prisma } from "@/server/prisma";

export type NotificationType = "formSubmissions" | "blogComments" | "payments" | "commentMentions";

async function loadPreferences(organizationId: string) {
  return prisma.notificationPreferences.findUnique({
    where: { organizationId },
    select: { formSubmissions: true, blogComments: true, payments: true, commentMentions: true, notificationEmail: true },
  });
}

/** A missing NotificationPreferences row (the common case; most orgs never visit the
 * settings toggle) means every type's own schema default applies, not "notifications off." */
function isEnabled(prefs: Awaited<ReturnType<typeof loadPreferences>>, type: NotificationType): boolean {
  return prefs ? prefs[type] : type !== "formSubmissions"; // mirrors each field's own @default in schema.prisma
}

/**
 * For "notify the site's shared inbox" cases (a form was submitted, a blog got a comment,
 * a payment came in) — resolves both whether to send AND where, honoring the org's
 * notificationEmail override when set. Call this right before actually sending, not
 * earlier, so it's the single gate every one of those call sites defers to instead of each
 * reading NotificationPreferences directly and risking a different default drifting in.
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
 * For "notify this specific person" cases (an @mention) — the recipient is fixed (the
 * person who was actually mentioned), so only the on/off gate applies; the org's
 * notificationEmail override has no business redirecting someone else's personal mention
 * notice to a shared inbox.
 */
export async function isNotificationEnabled(organizationId: string, type: NotificationType): Promise<boolean> {
  return isEnabled(await loadPreferences(organizationId), type);
}
