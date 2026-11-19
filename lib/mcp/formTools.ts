import type { resolveUser } from "@/lib/auth/resolveUser";
import { Template } from "@/lib/db/contentEntities";
import { FormSettingsError, listFormSettings, saveFormSettings } from "@/lib/forms/formSettingsService";

type ResolvedUser = NonNullable<Awaited<ReturnType<typeof resolveUser>>>;

// Where a site's forms send submissions — parity with the "Where submissions go" section of
// the dashboard's Form Submissions page.

export const FORM_MCP_TOOLS = [
  {
    name: "get_form_settings",
    description:
      "Lists every form on a site and where its submissions go besides the Form Submissions inbox and the owner's email: a MailDrip list and/or a webhook (Zapier, Make, a CRM), plus a thank-you page, the verification box (captcha: Cloudflare Turnstile, Google reCAPTCHA or hCaptcha) a form has — with active:false meaning its secret key still needs saving — and anything a migrated WordPress form did that Plexo doesn't repeat (note). Also says whether MailDrip is connected and lists the account's MailDrip lists (ids to use with set_form_destinations).",
    inputSchema: {
      type: "object",
      properties: { templateId: { type: "string", description: "The site's home page id (see list_landing_pages)." } },
      required: ["templateId"],
    },
  },
  {
    name: "set_form_destinations",
    description:
      "Sets where one form sends each submission: maildripGroupId adds the person (email and name, taken from the submission) to that MailDrip list in the site's own MailDrip account — MailDrip must be connected first; webhookUrl POSTs every submission (https only). Pass null to stop one. captcha adds or fixes the form's verification box: provider, the public siteKey and the secretKey from the owner's Cloudflare/Google/hCaptcha account (the secret is stored encrypted and never shown again; leave it out to keep the one already saved) — pass null to remove the box. A migrated WordPress form that had a box shows captcha.active false until its secret key is saved. Form names come from get_form_settings.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "The site's home page id." },
        formName: { type: "string", description: "Exactly as get_form_settings lists it." },
        maildripGroupId: { type: ["string", "null"], description: "A list id from get_form_settings' maildrip.groups, or null to stop adding to a list." },
        webhookUrl: { type: ["string", "null"], description: "https address to send each submission to, or null to stop." },
        captcha: {
          type: ["object", "null"],
          description: "The form's verification box, or null to remove it.",
          properties: {
            provider: { type: "string", enum: ["turnstile", "recaptcha", "hcaptcha"] },
            siteKey: { type: "string", description: "The public site key." },
            secretKey: { type: "string", description: "The secret key. Omit to keep the one already saved." },
          },
          required: ["provider", "siteKey"],
        },
      },
      required: ["templateId", "formName"],
    },
  },
];

export const FORM_TOOL_NAMES = new Set(FORM_MCP_TOOLS.map((t) => t.name));

async function resolveSiteId(resolved: ResolvedUser, templateId: unknown): Promise<string> {
  const id = typeof templateId === "string" ? templateId.trim() : "";
  if (!id) throw new Error("templateId is required — pass the site's home page id (see list_landing_pages).");
  const { data: site } = await Template.get({ id }).go();
  if (!site || site.organizationId !== resolved.organizationId || site.parentId) {
    throw new Error(`No site found with id "${id}" in this account. Use a site's home page id from list_landing_pages.`);
  }
  return site.id;
}

export async function handleFormTool(toolName: string, args: any, resolved: ResolvedUser): Promise<any> {
  const templateId = await resolveSiteId(resolved, args?.templateId);
  if (toolName === "get_form_settings") {
    const overview = await listFormSettings(templateId);
    return {
      ...overview,
      next: overview.maildrip.connected
        ? "Use set_form_destinations to add a form's sign-ups to one of these MailDrip lists, or to send its submissions to a webhook."
        : "MailDrip isn't connected for this site — the owner connects it from the Form Submissions page (Connect MailDrip). Webhooks work without it.",
    };
  }
  try {
    const form = await saveFormSettings(templateId, { formName: String(args?.formName ?? ""), maildripGroupId: args?.maildripGroupId, webhookUrl: args?.webhookUrl, captcha: args?.captcha });
    return { form, next: "New submissions to this form go there from now on. Suggest the owner sends a test submission to check it arrives." };
  } catch (err) {
    if (err instanceof FormSettingsError) throw new Error(err.message);
    throw err;
  }
}
