import { CommerceSettings } from "@/lib/db/commerceEntities";
import { FormSettings, FormSubmission } from "@/lib/db/opsEntities";
import { WpMigrationJob } from "@/lib/db/importEntities";
import { decryptMaildripKey, tryDecrypt } from "@/lib/crypto";
import { listMaildripGroups, type MaildripGroup } from "@/lib/maildripGroups";
import { validWebhookUrl } from "@/lib/forms/formActions";
import { encryptSecret } from "@/lib/crypto";
import { isCaptchaProvider, validSiteKey, type CaptchaProvider } from "@/lib/forms/captcha";

// Shared by the Form Submissions page's "where submissions go" settings and the MCP tool.

export interface FormDestinations {
  formName: string;
  maildripGroupId: string | null;
  maildripGroupTitle: string | null;
  webhookUrl: string | null;
  /** After submitting, visitors go here (a thank-you page). */
  redirectUrl: string | null;
  source: string | null;
  note: string | null;
  /** The "I'm not a robot" check from WordPress. `active` is false until the secret key is saved — the owner is asked for it. */
  captcha: { provider: CaptchaProvider; siteKey: string; active: boolean } | null;
  lastDeliveredAt: string | null;
  lastDeliveryError: string | null;
}

export interface FormSettingsOverview {
  forms: FormDestinations[];
  maildrip: { connected: boolean; groups: MaildripGroup[]; error: string | null };
}

/** Every form this site has (from its submissions, saved settings and a WordPress migration's report), with where each one sends submissions. */
export async function listFormSettings(templateId: string): Promise<FormSettingsOverview> {
  const [{ data: settings }, { data: submissions }, { data: jobs }, { data: commerce }] = await Promise.all([
    FormSettings.query.primary({ templateId }).go({ pages: "all" }),
    FormSubmission.query.primary({ templateId }).go({ pages: "all", attributes: ["formName"] }),
    WpMigrationJob.query.primary({ templateId }).go({ pages: "all", attributes: ["report", "createdAt"] }),
    CommerceSettings.get({ templateId }).go(),
  ]);
  const names = new Set<string>();
  for (const s of settings) names.add(s.formName);
  for (const s of submissions) names.add(s.formName ?? "Website Form");
  const latest = jobs.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))[0];
  for (const f of ((latest?.report as { forms?: { name: string }[] } | undefined)?.forms ?? [])) names.add(f.name);

  const byName = new Map(settings.map((s) => [s.formName, s]));
  const forms = Array.from(names)
    .sort((a, b) => a.localeCompare(b))
    .map((formName): FormDestinations => {
      const s = byName.get(formName);
      return {
        formName,
        maildripGroupId: s?.maildripGroupId ?? null,
        maildripGroupTitle: s?.maildripGroupTitle ?? null,
        webhookUrl: s?.webhookUrl ?? null,
        redirectUrl: s?.redirectUrl ?? null,
        source: s?.source ?? null,
        note: s?.note ?? null,
        captcha: s?.captchaProvider && s.captchaSiteKey ? { provider: s.captchaProvider, siteKey: s.captchaSiteKey, active: Boolean(s.captchaSecretEncrypted) } : null,
        lastDeliveredAt: s?.lastDeliveredAt ?? null,
        lastDeliveryError: s?.lastDeliveryError ?? null,
      };
    });

  const apiKey = commerce?.maildripApiKeyEncrypted ? tryDecrypt(() => decryptMaildripKey(commerce.maildripApiKeyEncrypted!)) : null;
  let groups: MaildripGroup[] = [];
  let error: string | null = null;
  if (apiKey) {
    try {
      groups = await listMaildripGroups(apiKey);
    } catch (err) {
      error = err instanceof Error ? err.message : "Couldn't load your MailDrip lists.";
    }
  }
  return { forms, maildrip: { connected: Boolean(apiKey), groups, error } };
}

export class FormSettingsError extends Error {}

/** Sets where one form sends submissions. null clears a destination; undefined leaves it as it is. */
export async function saveFormSettings(
  templateId: string,
  input: { formName: string; maildripGroupId?: string | null; webhookUrl?: string | null; captcha?: { provider: string; siteKey: string; secretKey?: string } | null },
): Promise<FormDestinations> {
  const formName = input.formName?.trim();
  if (!formName) throw new FormSettingsError("Choose which form to set up.");
  type Field = "maildripGroupId" | "maildripGroupTitle" | "webhookUrl" | "captchaProvider" | "captchaSiteKey" | "captchaSecretEncrypted";
  const set: Partial<Record<Exclude<Field, "captchaProvider">, string>> & { captchaProvider?: CaptchaProvider } = {};
  const remove: (Field | "lastDeliveryError")[] = [];

  if (input.captcha === null) remove.push("captchaProvider", "captchaSiteKey", "captchaSecretEncrypted");
  else if (input.captcha) {
    const { provider, siteKey, secretKey } = input.captcha;
    if (!isCaptchaProvider(provider)) throw new FormSettingsError("Choose Cloudflare Turnstile, Google reCAPTCHA or hCaptcha.");
    if (!validSiteKey(siteKey?.trim())) throw new FormSettingsError("Enter the site key exactly as your captcha provider shows it (the public one).");
    set.captchaProvider = provider;
    set.captchaSiteKey = siteKey.trim();
    // Left empty, the secret already saved stays — so the site key can be fixed without pasting both again.
    if (secretKey?.trim()) set.captchaSecretEncrypted = encryptSecret(secretKey.trim());
  }

  if (input.webhookUrl !== undefined) {
    if (input.webhookUrl === null || input.webhookUrl.trim() === "") remove.push("webhookUrl");
    else {
      const url = validWebhookUrl(input.webhookUrl);
      if (!url) throw new FormSettingsError("Enter the full webhook address, starting with https://");
      set.webhookUrl = url;
    }
  }
  if (input.maildripGroupId !== undefined) {
    if (input.maildripGroupId === null || input.maildripGroupId === "") remove.push("maildripGroupId", "maildripGroupTitle");
    else {
      const { maildrip } = await listFormSettings(templateId);
      if (!maildrip.connected) throw new FormSettingsError("Connect MailDrip first, then pick the list.");
      const group = maildrip.groups.find((g) => g.id === input.maildripGroupId);
      if (!group) throw new FormSettingsError("That MailDrip list wasn't found in your account — pick one from the list.");
      set.maildripGroupId = group.id;
      set.maildripGroupTitle = group.title;
    }
  }

  const { data: existing } = await FormSettings.get({ templateId, formName }).go();
  if (!existing) {
    await FormSettings.create({ templateId, formName, ...set }).go();
  } else {
    let patch = FormSettings.patch({ templateId, formName }).set({ ...set });
    // A changed setup starts with a clean slate: the old delivery problem no longer applies.
    if (remove.length > 0 || Object.keys(set).length > 0) patch = patch.remove([...remove, "lastDeliveryError"]);
    await patch.go();
  }
  const { forms } = await listFormSettings(templateId);
  return forms.find((f) => f.formName === formName)!;
}
