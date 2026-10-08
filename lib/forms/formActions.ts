import { CommerceSettings } from "@/lib/db/commerceEntities";
import { FormSettings } from "@/lib/db/opsEntities";
import { addContactToMaildripGroup } from "@/lib/commerce/maildripNotify";
import { decryptMaildripKey, tryDecrypt } from "@/lib/crypto";
import { safeFetch } from "@/lib/siteImport/fetchSafe";
import { isLikelySpam } from "@/lib/forms/spamHeuristics";

// What a form does with each submission besides the inbox and the owner's email (see
// FormSettings): add the person to a MailDrip list, and/or send the submission to a
// webhook. Best-effort — a visitor's submission is already saved; a MailDrip or webhook
// outage is recorded on the form's settings for the owner to see, never shown to them.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The person in a submission: an email field (by name, else by shape) and their name. */
export function contactFromFields(fields: Record<string, string>): { email: string; firstName?: string; lastName?: string; phone?: string } | null {
  const entries = Object.entries(fields);
  const byKey = (re: RegExp) => entries.find(([k]) => re.test(k))?.[1]?.trim();
  const email = [byKey(/e-?mail/i), ...entries.map(([, v]) => v.trim())].find((v): v is string => Boolean(v && EMAIL.test(v)));
  if (!email) return null;
  let firstName = byKey(/first.?name|^fname$|given/i);
  let lastName = byKey(/last.?name|surname|^lname$|family/i);
  const fullName = byKey(/^(full.?)?name$|your.?name/i);
  if (!firstName && fullName) {
    const [first, ...rest] = fullName.split(/\s+/);
    firstName = first;
    lastName = lastName ?? (rest.join(" ") || undefined);
  }
  const phone = byKey(/phone|mobile|tel/i);
  return { email: email.toLowerCase(), ...(firstName ? { firstName } : {}), ...(lastName ? { lastName } : {}), ...(phone ? { phone } : {}) };
}

/** Runs this form's actions for one submission. Never throws. */
export async function runFormActions(input: { templateId: string; formName: string; fields: Record<string, string>; siteHost?: string | null }): Promise<void> {
  try {
    const { data: settings } = await FormSettings.get({ templateId: input.templateId, formName: input.formName }).go();
    if (!settings || (!settings.maildripGroupId && !settings.webhookUrl)) return;
    // Obvious spam stays in the inbox for the owner to delete — it shouldn't land on their list.
    if (isLikelySpam(input.fields)) return;

    const problems: string[] = [];
    if (settings.maildripGroupId) {
      const problem = await addToMaildrip(input.templateId, settings.maildripGroupId, input.fields);
      if (problem) problems.push(problem);
    }
    if (settings.webhookUrl) {
      const problem = await postWebhook(settings.webhookUrl, settings.webhookFormat ?? "json", input);
      if (problem) problems.push(problem);
    }
    const status = FormSettings.patch({ templateId: input.templateId, formName: input.formName });
    await (problems.length > 0
      ? status.set({ lastDeliveryError: problems.join(" ") })
      : status.set({ lastDeliveredAt: new Date().toISOString() }).remove(["lastDeliveryError"])
    ).go();
  } catch (err) {
    console.error("[forms] form actions failed:", err);
  }
}

async function addToMaildrip(templateId: string, groupId: string, fields: Record<string, string>): Promise<string | null> {
  const contact = contactFromFields(fields);
  if (!contact) return "A submission had no email address, so it wasn't added to your MailDrip list.";
  const { data: commerce } = await CommerceSettings.get({ templateId }).go();
  // Always the site's own MailDrip account — never Plexo's — so contacts land on the owner's list.
  const apiKey = commerce?.maildripApiKeyEncrypted ? tryDecrypt(() => decryptMaildripKey(commerce.maildripApiKeyEncrypted!)) : null;
  if (!apiKey) return "MailDrip isn't connected for this site, so new sign-ups aren't reaching your list — connect it on the Form Submissions page.";
  try {
    await addContactToMaildripGroup(apiKey, groupId, contact);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "MailDrip didn't accept the contact.";
  }
}

async function postWebhook(url: string, format: "json" | "form", input: { formName: string; fields: Record<string, string>; siteHost?: string | null }): Promise<string | null> {
  try {
    // "form": the fields under their labels, form-encoded — what WordPress form plugins'
    // webhooks sent, so a receiver set up for the old site needs no change.
    const body =
      format === "form"
        ? new URLSearchParams({ ...input.fields, form_name: input.formName, ...(input.siteHost ? { "Page URL": `https://${input.siteHost}` } : {}) }).toString()
        : JSON.stringify({ form: input.formName, site: input.siteHost ?? null, submittedAt: new Date().toISOString(), fields: input.fields });
    const res = await safeFetch(url, {
      method: "POST",
      headers: { "Content-Type": format === "form" ? "application/x-www-form-urlencoded" : "application/json", "User-Agent": "Plexo-Forms/1.0" },
      body,
      signal: AbortSignal.timeout(10_000),
      maxRedirects: 2,
    });
    return res.ok ? null : `Your webhook answered ${res.status}.`;
  } catch (err) {
    return `Your webhook couldn't be reached (${err instanceof Error ? err.message : "network error"}).`;
  }
}

/** A webhook address the owner can save: https only, a public host. */
export function validWebhookUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "https:" && url.hostname.includes(".") ? url.toString() : null;
  } catch {
    return null;
  }
}
