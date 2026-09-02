import { NextRequest, NextResponse } from "next/server";

import { resolveUser } from "@/lib/auth/resolveUser";
import { NotificationPreferences } from "@/lib/db/coreEntities";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Schema defaults live here too (matches lib/notificationPreferencesDynamo.ts's own
// isEnabled fallback) so a GET before any row exists reflects the same "on unless it's
// brand new" behavior the actual send-time gate uses — never a mismatch between what the
// toggle shows and what would really happen.
const DEFAULTS = { formSubmissions: false, blogComments: true, payments: true, commentMentions: true };

export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: prefs } = await NotificationPreferences.get({ organizationId: resolved.organizationId }).go();
  return NextResponse.json({
    formSubmissions: prefs?.formSubmissions ?? DEFAULTS.formSubmissions,
    blogComments: prefs?.blogComments ?? DEFAULTS.blogComments,
    payments: prefs?.payments ?? DEFAULTS.payments,
    commentMentions: prefs?.commentMentions ?? DEFAULTS.commentMentions,
    notificationEmail: prefs?.notificationEmail ?? null,
  });
}

type PatchBody = {
  formSubmissions?: boolean;
  blogComments?: boolean;
  payments?: boolean;
  commentMentions?: boolean;
  notificationEmail?: string | null;
};

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as PatchBody;
  const data: Partial<typeof DEFAULTS> & { notificationEmail?: string | null } = {};

  for (const key of ["formSubmissions", "blogComments", "payments", "commentMentions"] as const) {
    if (typeof body[key] === "boolean") data[key] = body[key];
  }
  if (body.notificationEmail !== undefined) {
    const trimmed = body.notificationEmail?.trim() || null;
    if (trimmed && !EMAIL_PATTERN.test(trimmed)) {
      return NextResponse.json({ error: "That doesn't look like a valid email address." }, { status: 400 });
    }
    data.notificationEmail = trimmed;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No changes provided." }, { status: 400 });
  }

  // NotificationPreferences has no upsert primitive (ElectroDB's `.patch()` requires the
  // item to already exist) — get-then-create-or-patch, same discipline as every other
  // "one row per org, created lazily" entity in this migration.
  const { data: existing } = await NotificationPreferences.get({ organizationId: resolved.organizationId }).go();

  let updated: { formSubmissions?: boolean; blogComments?: boolean; payments?: boolean; commentMentions?: boolean; notificationEmail?: string };

  if (!existing) {
    const created = { ...DEFAULTS, ...data };
    await NotificationPreferences.create({
      id: resolved.organizationId,
      organizationId: resolved.organizationId,
      formSubmissions: created.formSubmissions,
      blogComments: created.blogComments,
      payments: created.payments,
      commentMentions: created.commentMentions,
      notificationEmail: created.notificationEmail ?? undefined,
    }).go();
    updated = { ...created, notificationEmail: created.notificationEmail ?? undefined };
  } else {
    // notificationEmail: null means "clear the override" — a `.remove()` rather than a
    // `.set()` of an empty string, since the attribute has no explicit default.
    const { notificationEmail, ...booleanFields } = data;
    const setFields = notificationEmail != null ? { ...booleanFields, notificationEmail } : booleanFields;

    if (notificationEmail === null) {
      await NotificationPreferences.patch({ organizationId: resolved.organizationId })
        .set(setFields)
        .remove(["notificationEmail"])
        .go();
    } else {
      await NotificationPreferences.patch({ organizationId: resolved.organizationId }).set(setFields).go();
    }

    updated = {
      formSubmissions: data.formSubmissions ?? existing.formSubmissions,
      blogComments: data.blogComments ?? existing.blogComments,
      payments: data.payments ?? existing.payments,
      commentMentions: data.commentMentions ?? existing.commentMentions,
      notificationEmail: notificationEmail === null ? undefined : notificationEmail ?? existing.notificationEmail,
    };
  }

  return NextResponse.json({
    formSubmissions: updated.formSubmissions,
    blogComments: updated.blogComments,
    payments: updated.payments,
    commentMentions: updated.commentMentions,
    notificationEmail: updated.notificationEmail ?? null,
  });
}
