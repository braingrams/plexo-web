import { NextRequest, NextResponse } from "next/server";

import { resolveSite } from "@/lib/pub/resolveSiteDynamo";
import { checkCommerceRateLimit, clientIp } from "@/lib/commerceRateLimitDynamo";
import { collectFormFields, recordFormSubmission } from "@/lib/forms/recordSubmission";
import { FormSettings } from "@/lib/db/opsEntities";
import { Template } from "@/lib/db/contentEntities";
import { designFormatOf } from "@/lib/v2/design";
import { V2_FORM_HONEYPOT_FIELD_NAME, findV2Form, relabelV2Fields } from "@/lib/v2/forms";

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
// Must match plexo-sdk's compiler.ts FORM_HONEYPOT_FIELD_NAME exactly — every compiled
// form_container carries one extra input under this name, collapsed to nothing via CSS
// (not type="hidden", which some bots specifically know to skip) so a real visitor never
// sees or fills it. Hardcoded rather than imported: the SDK version currently pinned in
// package.json predates this field, so the export doesn't exist yet on this side until
// that dependency is bumped — see the SDK-repo commit that introduced it.
const HONEYPOT_FIELD_NAME = V2_FORM_HONEYPOT_FIELD_NAME; // same name in V1 and V2 forms

export async function POST(request: NextRequest, { params }: { params: Promise<{ templateId: string }> }): Promise<NextResponse> {
  const { templateId } = await params;
  // public/plexo-forms.js (forms in raw HTML / React / the visual builder) asks for JSON and
  // shows the thank-you in place; a plain browser form post still gets the redirect below.
  const wantsJson = (request.headers.get("accept") ?? "").includes("application/json");
  const hostname = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(":")[0];
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

  // A real visitor's browser sends Referer/Origin for a same-origin form POST (default
  // under every standard referrer-policy); a script posting straight to this URL from
  // outside a real page load either omits both or sends one pointing somewhere else
  // entirely. Only rejects on an actual MISMATCH, never on absence — some real visitors
  // do have Referer stripped by a privacy setting/extension, and that alone shouldn't cost
  // them their message. Same silent-success response as the honeypot below: a rejected bot
  // gets no signal to detect and route around.
  const originHeader = request.headers.get("origin") ?? request.headers.get("referer");
  if (originHeader) {
    let originHost: string | null = null;
    try {
      originHost = new URL(originHeader).hostname;
    } catch {
      originHost = null;
    }
    if (originHost && originHost !== hostname) {
      console.info(`[forms] origin mismatch: templateId=${templateId} origin=${originHost} expected=${hostname}`);
      if (wantsJson) return NextResponse.json({ ok: true, redirect: null });
      const redirectParam = new URL(request.url).searchParams.get("redirect") || "/";
      const redirectPath = redirectParam.startsWith("/") ? redirectParam : "/";
      return NextResponse.redirect(new URL(redirectPath, request.url), { status: 303 });
    }
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form submission." }, { status: 400 });
  }

  let fields = collectFormFields(formData.entries());
  if (Object.keys(fields).length === 0) {
    return NextResponse.json({ error: "Please fill in the form before sending." }, { status: 400 });
  }

  const url = new URL(request.url);
  const formName = url.searchParams.get("form")?.slice(0, 100) || "Website Form";
  // Same-origin only — an author's redirect param controls where their own visitor lands
  // after submitting, never an arbitrary external URL a copied/tampered action could point
  // at instead.
  // No redirect given (new-editor forms don't set one): send the visitor back to the page they
  // were on, when the browser told us (same site only), else the home page.
  const refererPath = (() => {
    try {
      const ref = new URL(originHeader ?? "");
      return ref.hostname === hostname ? ref.pathname : null;
    } catch {
      return null;
    }
  })();
  const redirectParam = url.searchParams.get("redirect") || refererPath || "/";
  const redirectPath = redirectParam.startsWith("/") && !redirectParam.startsWith("//") ? redirectParam : "/";

  // New-editor (V2) forms name inputs after field ids; find the form in its page's design and
  // restore the labels so the inbox reads "Phone number: ..." rather than "f3: ...".
  const pageId = url.searchParams.get("page");
  const formNodeId = url.searchParams.get("fid");
  const resolvedFormName = formName;
  if (pageId && formNodeId) {
    const { data: page } = await Template.get({ id: pageId }).go();
    if (page && page.organizationId === organization.id && designFormatOf(page) === "v2") {
      const v2Form = findV2Form(page.designJson, formNodeId);
      if (v2Form) fields = relabelV2Fields(fields, v2Form);
    }
  }

  // Honeypot: a real visitor never sees or fills HONEYPOT_FIELD_NAME (it's CSS-collapsed
  // to nothing in every compiled form_container — see its compiler-side comment), but a
  // bot that blindly fills every <input> it finds fills this one too. Respond with the
  // exact same success redirect a real submission gets below — never a 400/403 — so an
  // automated submitter has no signal to detect and adapt around the check. The
  // submission itself is silently dropped: no FormSubmission record, no notification
  // email, just a log line carrying no submitted content.
  const honeypotValue = formData.get(HONEYPOT_FIELD_NAME);
  if (typeof honeypotValue === "string" && honeypotValue.trim()) {
    console.info(`[forms] honeypot catch: templateId=${templateId} at=${new Date().toISOString()}`);
    if (wantsJson) return NextResponse.json({ ok: true, redirect: null });
    return NextResponse.redirect(new URL(redirectPath, request.url), { status: 303 });
  }

  await recordFormSubmission({ templateId, organizationId: organization.id, formName: resolvedFormName, fields, submitterIp: clientIp(request), siteHost: hostname });

  // A thank-you page set for this form (e.g. carried over from WordPress) wins over the
  // default of showing the confirmation on the same page.
  const { data: formSettings } = await FormSettings.get({ templateId, formName }).go();
  const thankYou = formSettings?.redirectUrl;
  const validThankYou = thankYou && (thankYou.startsWith("/") || /^https:\/\//i.test(thankYou)) ? thankYou : null;
  if (wantsJson) return NextResponse.json({ ok: true, redirect: validThankYou });
  if (validThankYou) {
    return NextResponse.redirect(new URL(validThankYou, request.url), { status: 303 });
  }
  return NextResponse.redirect(new URL(redirectPath, request.url), { status: 303 });
}

