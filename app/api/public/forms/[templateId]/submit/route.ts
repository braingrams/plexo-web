import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/server/prisma";
import { resolveSite } from "@/lib/pub/resolveSite";
import { checkCommerceRateLimit, clientIp } from "@/lib/commerceRateLimit";
import { resolveNotificationRecipient } from "@/lib/notificationPreferences";
import { sendMaildripEmail } from "@/lib/mail/maildrip";
import { buildFormSubmissionEmail } from "@/lib/mail/templates";

/**
 * Receives a real, no-JS browser form submission from a form_container's own <form
 * action="/api/public/forms/[templateId]/submit?form=...&redirect=..."> — see
 * sanitizeCompiledHtml's FIX-004, which is what lets that <form> survive publish at all.
 * There is no client JS to intercept this (nothing published ever carries a <script>), so
 * this is a genuine full-page POST navigation: the response has to be an HTTP redirect, not
 * a JSON body, or the visitor lands on a raw JSON page after sending a message.
 *
 * [templateId] in the URL is redundant with the Host-header site resolution below by
 * design, not load-bearing for security — it's there so a mismatch (a stale/copied action
 * URL from a different site) fails loudly instead of silently filing a submission under the
 * wrong site.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await params;
  const hostname = (request.headers.get("host") ?? "").split(":")[0];
  const siteResult = await resolveSite(hostname);
  if (siteResult.status !== "ok") {
    return NextResponse.json({ error: "Site not found." }, { status: 404 });
  }
  const { templateId: resolvedTemplateId, organization } = siteResult.published;
  if (resolvedTemplateId !== templateId) {
    return NextResponse.json({ error: "This form's action URL doesn't match the site it was submitted from." }, { status: 400 });
  }

  const allowed = await checkCommerceRateLimit(`forms:submit:${templateId}:${clientIp(request)}`, 10);
  if (!allowed) {
    return NextResponse.json({ error: "Too many submissions. Please try again shortly." }, { status: 429 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form submission." }, { status: 400 });
  }

  const fields: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && value.trim()) fields[key] = value.trim().slice(0, 5000);
  }
  if (Object.keys(fields).length === 0) {
    return NextResponse.json({ error: "Empty submission." }, { status: 400 });
  }

  const url = new URL(request.url);
  const formName = url.searchParams.get("form")?.slice(0, 100) || "Website Form";
  // Same-origin only — an author's redirect param controls where their own visitor lands
  // after submitting, never an arbitrary external URL a copied/tampered action could point
  // at instead.
  const redirectParam = url.searchParams.get("redirect") || "/";
  const redirectPath = redirectParam.startsWith("/") ? redirectParam : "/";

  await prisma.formSubmission.create({
    data: {
      templateId,
      organizationId: organization.id,
      formName,
      fields,
      submitterIp: clientIp(request),
    },
  });

  void notifyFormSubmission(templateId, organization.id, formName, fields).catch((err) =>
    console.error("[mail] form submission notification failed:", err),
  );

  return NextResponse.redirect(new URL(redirectPath, request.url), { status: 303 });
}

async function notifyFormSubmission(
  templateId: string,
  organizationId: string,
  formName: string,
  fields: Record<string, string>,
): Promise<void> {
  const template = await prisma.template.findUnique({ where: { id: templateId }, select: { name: true, user: { select: { email: true } } } });
  if (!template) return;

  const to = await resolveNotificationRecipient(organizationId, "formSubmissions", template.user?.email);
  if (!to) return;

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const html = buildFormSubmissionEmail({
    siteName: template.name,
    formName,
    fieldsPreview: Object.entries(fields).slice(0, 8) as [string, string][],
    submissionsUrl: `${base}/dashboard/templates/${templateId}/form-submissions`,
  });
  await sendMaildripEmail({ to, subject: `New ${formName} submission on ${template.name}`, html });
}
