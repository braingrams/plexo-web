import { PlatformSettings } from "@/lib/db/coreEntities";
import { cleanAdminAlertRoutes, DEFAULT_ADMIN_ALERT_EMAIL, recipientsForTopic, type AdminAlertRoutes, type AdminAlertTopic } from "./alertTopics";

const TTL_MS = 60_000;
let cache: { routes: AdminAlertRoutes; at: number } | null = null;

export const fallbackAdminEmail = (): string => (process.env.ADMIN_EMAIL ?? "").trim() || DEFAULT_ADMIN_ALERT_EMAIL;

/** One small read of the platform settings, remembered for a minute. A failure means "nobody chose", so the default address is used. */
async function routes(): Promise<AdminAlertRoutes> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.routes;
  try {
    const { data } = await PlatformSettings.get({}).go();
    cache = { routes: cleanAdminAlertRoutes(data?.adminAlerts), at: Date.now() };
  } catch {
    return {};
  }
  return cache.routes;
}

export async function adminAlertRecipients(topic: AdminAlertTopic): Promise<string[]> {
  return recipientsForTopic(topic, await routes(), fallbackAdminEmail());
}
