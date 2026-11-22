import { SiteConsentSettings } from "@/lib/db/opsEntities";
import { DEFAULT_CONSENT, type ConsentSettings } from "./model";

export { DEFAULT_CONSENT, normalizeConsentInput, type ConsentSettings } from "./model";

export async function loadConsentSettings(templateId: string): Promise<ConsentSettings> {
  const { data } = await SiteConsentSettings.get({ templateId }).go();
  if (!data) return DEFAULT_CONSENT;
  return {
    enabled: data.enabled ?? true,
    message: data.message || DEFAULT_CONSENT.message,
    acceptLabel: data.acceptLabel || DEFAULT_CONSENT.acceptLabel,
    declineLabel: data.declineLabel || DEFAULT_CONSENT.declineLabel,
    position: data.position ?? "bar",
    accentColor: data.accentColor ?? null,
  };
}

export async function saveConsentSettings(site: { id: string; organizationId: string }, settings: ConsentSettings): Promise<void> {
  await SiteConsentSettings.upsert({
    templateId: site.id,
    organizationId: site.organizationId,
    enabled: settings.enabled,
    message: settings.message,
    acceptLabel: settings.acceptLabel,
    declineLabel: settings.declineLabel,
    position: settings.position,
    accentColor: settings.accentColor ?? undefined,
  }).go();
  if (!settings.accentColor) await SiteConsentSettings.patch({ templateId: site.id }).remove(["accentColor"]).go();
}
