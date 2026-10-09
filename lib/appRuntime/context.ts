import type { EntityItem } from "electrodb";
import { Template } from "@/lib/db/contentEntities";
import { AppSettings, type AppEnv } from "@/lib/db/appEntities";
import { resolveSite } from "@/lib/pub/resolveSiteDynamo";
import { resolvePreviewHost } from "@/lib/projects/previewHost";
import { databaseName } from "@/lib/appData/db";

// Which app — and which of its two backends — a runtime request (/__plexo/api/* on some
// host) is for. A preview address talks to the app's "dev" database; its published domains
// talk to "live". Resolved per host and cached briefly, since every API call needs it.

export type AppSettingsItem = EntityItem<typeof AppSettings>;

export type AppContext = {
  templateId: string;
  organizationId: string;
  userId: string;
  appName: string;
  env: AppEnv;
  host: string;
  origin: string;
  database: string;
  settings: AppSettingsItem;
};

const cache = new Map<string, { ctx: AppContext | null; at: number }>();
const TTL_MS = 15_000;

export function defaultSettings(templateId: string, organizationId: string): AppSettingsItem {
  return {
    templateId,
    organizationId,
    authPassword: true,
    authMagicLink: true,
    authGoogle: true,
    requireEmailConfirmation: false,
    allowSignups: true,
  } as AppSettingsItem;
}

export async function getAppSettings(templateId: string, organizationId: string): Promise<AppSettingsItem> {
  const { data } = await AppSettings.get({ templateId }).go();
  return data ?? defaultSettings(templateId, organizationId);
}

export async function resolveAppContext(host: string): Promise<AppContext | null> {
  const key = host.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.ctx;
  const ctx = await load(key);
  cache.set(key, { ctx, at: Date.now() });
  if (cache.size > 2000) cache.delete(cache.keys().next().value!);
  return ctx;
}

export function forgetAppContext(templateId: string): void {
  for (const [k, v] of cache) if (v.ctx?.templateId === templateId) cache.delete(k);
}

/** Context for a known app + environment, verifying `host` really serves it (used where a
 * request arrives somewhere other than the app's own host, e.g. the platform OAuth callback). */
export async function appContextFor(templateId: string, env: AppEnv, host: string): Promise<AppContext | null> {
  const ctx = await resolveAppContext(host);
  return ctx && ctx.templateId === templateId && ctx.env === env ? ctx : null;
}

/** Context for reaching an app's database by id alone, before its host is known (only the
 * platform OAuth callback needs this; it re-verifies the host before signing anyone in). */
export async function appContextByTemplate(templateId: string, env: AppEnv): Promise<AppContext | null> {
  const { data: template } = await Template.get({ id: templateId }).go();
  if (!template || template.sourceType !== "REACT_PROJECT") return null;
  return {
    templateId: template.id,
    organizationId: template.organizationId,
    userId: template.userId,
    appName: template.name,
    env,
    host: "",
    origin: "",
    database: databaseName(template.id, env),
    settings: await getAppSettings(template.id, template.organizationId),
  };
}

async function load(host: string): Promise<AppContext | null> {
  let template: EntityItem<typeof Template> | null = null;
  let env: AppEnv = "live";
  const site = await resolveSite(host);
  if (site.status === "ok") {
    template = site.published.template;
  } else if (site.status === "not_found") {
    const preview = await resolvePreviewHost(host);
    if (preview) {
      template = (await Template.get({ id: preview.templateId }).go()).data;
      env = "dev";
    }
  }
  if (!template || template.sourceType !== "REACT_PROJECT") return null;
  const settings = await getAppSettings(template.id, template.organizationId);
  return {
    templateId: template.id,
    organizationId: template.organizationId,
    userId: template.userId,
    appName: template.name,
    env,
    host,
    origin: `https://${host}`,
    database: databaseName(template.id, env),
    settings,
  };
}
