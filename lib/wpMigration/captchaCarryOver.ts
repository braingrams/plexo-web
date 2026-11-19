// The verification box (captcha) a WordPress form had, kept on Plexo.
//
// The page tells us the public site key and which provider drew it (htmlTransform.ts); the
// Plexo Migrator plugin can also read the owner's secret key from WordPress's own settings.
// With both, the same box keeps protecting the form on Plexo with no work from the owner.
// With only the site key the form uses Plexo's honeypot and the owner is asked for the secret
// on the Form Submissions page — a box with nothing to check it would only be friction.

import { FormSettings } from "@/lib/db/opsEntities";
import { encryptSecret } from "@/lib/crypto";
import type { MigratedForm } from "./htmlTransform";

export interface ExportedCaptchaKeys {
  provider: "turnstile" | "recaptcha" | "hcaptcha";
  site_key: string;
  secret_key: string;
}

/** Remembers which verification box each migrated form had (site key only — no secret yet). */
export async function saveMigratedCaptcha(templateId: string, forms: MigratedForm[]): Promise<void> {
  for (const form of forms) {
    if (!form.captcha) continue;
    const { data: existing } = await FormSettings.get({ templateId, formName: form.name }).go();
    // Never overwrite what the owner already set up on Plexo.
    if (existing?.captchaProvider) continue;
    const captcha = { captchaProvider: form.captcha.provider, captchaSiteKey: form.captcha.siteKey };
    if (existing) await FormSettings.patch({ templateId, formName: form.name }).set(captcha).go();
    else await FormSettings.put({ templateId, formName: form.name, source: "wordpress", ...captcha }).go();
  }
}

/** Switches the box on for every migrated form whose public key matches the pair WordPress had. Returns how many forms were switched on. */
export async function applyCaptchaSecrets(templateId: string, forms: MigratedForm[], keys: ExportedCaptchaKeys[]): Promise<number> {
  let switchedOn = 0;
  const done = new Set<string>();
  for (const form of forms) {
    if (!form.captcha || done.has(form.name)) continue;
    const pair = keys.find((k) => k.provider === form.captcha!.provider && k.site_key === form.captcha!.siteKey && k.secret_key);
    if (!pair) continue;
    done.add(form.name);
    const { data: existing } = await FormSettings.get({ templateId, formName: form.name }).go();
    if (existing?.captchaSecretEncrypted) continue;
    const settings = { captchaProvider: pair.provider, captchaSiteKey: pair.site_key, captchaSecretEncrypted: encryptSecret(pair.secret_key) };
    if (existing) await FormSettings.patch({ templateId, formName: form.name }).set(settings).go();
    else await FormSettings.put({ templateId, formName: form.name, source: "wordpress", ...settings }).go();
    switchedOn++;
  }
  return switchedOn;
}
