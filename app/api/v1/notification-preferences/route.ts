import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/server/prisma";
import { resolveUser } from "@/app/api/v1/domains/route";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Schema defaults live here too (matches lib/notificationPreferences.ts's own isEnabled
// fallback) so a GET before any row exists reflects the same "on unless it's brand new"
// behavior the actual send-time gate uses — never a mismatch between what the toggle shows
// and what would really happen.
const DEFAULTS = { formSubmissions: false, blogComments: true, payments: true, commentMentions: true };

export async function GET(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const prefs = await prisma.notificationPreferences.findUnique({ where: { organizationId: resolved.organizationId } });
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

  const updated = await prisma.notificationPreferences.upsert({
    where: { organizationId: resolved.organizationId },
    create: { organizationId: resolved.organizationId, ...DEFAULTS, ...data },
    update: data,
  });

  return NextResponse.json({
    formSubmissions: updated.formSubmissions,
    blogComments: updated.blogComments,
    payments: updated.payments,
    commentMentions: updated.commentMentions,
    notificationEmail: updated.notificationEmail,
  });
}
