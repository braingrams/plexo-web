import { createHash } from "node:crypto";
import { brandStylesheet, createDefaultDesignSystem, type DesignSystem } from "@charisol/plexo-sdk/v2/compile";
import { baseOf, componentFromStrata, createStrataClient, planAutoUpdate, StrataError, tokenFromStrata, type StrataProjectSummary, type StrataSnapshot } from "@charisol/plexo-sdk/v2/strata";
import { SiteBrand, SiteBrandMapping, StrataProjectWebhook } from "@/lib/db/coreEntities";
import { Template } from "@/lib/db/contentEntities";
import { decryptStrataToken, encryptStrataToken } from "@/lib/crypto";
import { loadStrataToken } from "@/lib/strata/session";
import { strataApiUrl } from "@/lib/strata/apiUrl";
import { brandStore } from "./store";
import { pickLogoAsset, strataPushTokens } from "./brandModel";
import { resolveSiteBrand } from "./resolveSiteBrand";

// A site's brand, linked from Strata — ONE Strata project per site, whatever the site is made of (visual-builder pages, raw
// HTML, a WordPress migration, a React app, a deployed static site or server app).
//
//   link     the owner picks a Strata project: a read-only integration key is made with their own Strata session, the
//            PUBLISHED design system is pulled, saved, and written out as the site's hosted brand sheet
//            (/__plexo/brand/<siteId>.css, lib/brand/store.ts). Every page of the site links to it, so from then on a brand
//            change never needs the pages rebuilt. Plexo also subscribes to the project's "published" webhook.
//   sync     Strata calls POST /api/v1/strata/webhook when someone PUBLISHES (autosaves don't count). For every site linked to
//            that project with "Keep in sync" on: pull, the SDK's planAutoUpdate, save, regenerate the sheet. Token changes stop
//            there (live within a minute or two); component changes also recompile the pages, because a page's component
//            styles are written into it. A 15-minute sweep does the same as a fallback for a missed webhook.
//   unlink   the key is revoked, the sheet removed, and pages go back to the values they were built with.
//
// Everything that can go wrong is recorded on the site's row in words the owner can act on.

export type BrandResultKind = "updated" | "up-to-date" | "needs-review" | "error" | "reconnect";
export type BrandSource = "webhook" | "schedule" | "owner";

export type SiteBrandState = {
  linked: boolean;
  projectId: string | null;
  projectName: string | null;
  autoSync: boolean;
  status: "active" | "needs-reconnect" | "off";
  /** When the brand on the live site last changed. */
  updatedAt: string | null;
  lastCheckedAt: string | null;
  lastResult: string | null;
  lastResultKind: BrandResultKind | null;
  lastSource: BrandSource | null;
  /** Raw-HTML / WordPress sites: the site's own colours and fonts follow the brand. */
  useOnSite: boolean;
  /** Raw-HTML / WordPress sites: Plexo found colours/fonts it can match to the brand. */
  canUseOnSite: boolean;
  /** A deployed server app (own code): the owner can let Plexo add the brand link to the pages it serves. */
  serverApp?: boolean;
  /** That switch. Off unless the owner turned it on (or linked the brand after server-app support shipped). */
  brandInApp?: boolean;
  /** The address of the hosted brand sheet, for an owner's own code (apps, server apps). */
  stylesheet: string | null;
  /** The Strata project has no published version yet: the owner presses Publish in Strata once and syncing starts. */
  awaitingPublish: boolean;
  /** The owner's latest colours/logo are saved on Plexo but have not reached Strata yet (retried automatically). */
  sendPending?: boolean;
};

export class BrandError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export const RECONNECT_NOTE = "Plexo lost access to this Strata project. Link it again to keep your brand up to date.";
export const NEEDS_REVIEW_NOTE = "Strata has changes that need a look before they go live — open Branding in the editor.";
const TRY_AGAIN_NOTE = "Couldn't reach Strata just now. Plexo will try again in a few minutes.";
export const WAITING_FOR_PUBLISH_NOTE = "Your brand is saved in Strata. Press Publish there once to start keeping it in sync.";
const NOT_PUBLISHED_NOTE = WAITING_FOR_PUBLISH_NOTE;
const NEW_LOGO_NOTE = "Your new logo from Strata is on your site.";
const NEW_LOGO_SAVED_NOTE = "Your new logo from Strata is saved and will be used on new pages.";
const LOCK_STALE_MS = 10 * 60 * 1000;

const now = () => new Date().toISOString();

type Row = NonNullable<Awaited<ReturnType<ReturnType<typeof SiteBrand.get>["go"]>>["data"]>;

// ---------------------------------------------------------------- Strata calls

function base(): string {
  const url = strataApiUrl();
  if (!url) throw new BrandError("Strata isn't set up on this Plexo yet.", 503);
  return url;
}

export async function strataFetch(path: string, token: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
  try {
    return await fetch(`${base()}${path}`, {
      method: init.method ?? "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new StrataError("Couldn't reach Strata. Check your connection and try again.", "network");
  }
}

export const pid = (projectId: string) => encodeURIComponent(projectId);

/**
 * The design system as last PUBLISHED in Strata (never in-progress edits). `allowDraft` (linking only) falls back to the latest
 * saved version for a project that has never been published, so linking always shows something.
 */
export async function pullPublished(token: string, projectId: string, opts: { allowDraft?: boolean } = {}): Promise<StrataSnapshot & { draft?: boolean; logo?: StrataLogo | null }> {
  let res = await strataFetch(`/projects/${pid(projectId)}/design-system?source=published`, token);
  let draft = false;
  if (res.status === 404 || res.status === 400) {
    const body = (await res.clone().json().catch(() => ({}))) as { error?: { code?: string } };
    const notPublished = body.error?.code === "NOT_PUBLISHED";
    // 400: a Strata from before ?source existed. NOT_PUBLISHED: nothing published yet (only a link may use the draft).
    if (res.status === 400 || (notPublished && opts.allowDraft)) {
      res = await strataFetch(`/projects/${pid(projectId)}/design-system`, token);
      draft = notPublished;
    } else if (notPublished) {
      throw new BrandError("This Strata project hasn't been published yet.", 409);
    }
  }
  if (res.status === 401) throw new StrataError("Plexo's access to this Strata project has stopped.", "expired", 401);
  if (res.status === 403) throw new StrataError("Plexo can't read this Strata project.", "forbidden", 403);
  if (res.status === 404) throw new StrataError("That Strata project wasn't found. It may have been deleted, or you may no longer have access.", "not_found", 404);
  if (!res.ok) throw new StrataError("Strata had a problem. Please try again in a moment.", "server", res.status);
  const body = (await res.json().catch(() => ({}))) as { data?: { revision?: string; variables?: unknown[]; components?: unknown[]; logo?: unknown } };
  const d = body.data ?? {};
  return {
    logo: parseStrataLogo(d.logo),
    revision: typeof d.revision === "string" ? d.revision : undefined,
    tokens: (Array.isArray(d.variables) ? d.variables : []).map((v) => tokenFromStrata(v as Record<string, unknown>)),
    components: (Array.isArray(d.components) ? d.components : []).map((c) => componentFromStrata(c as Record<string, unknown>)),
    ...(draft ? { draft: true } : {}),
  };
}

/**
 * The project's primary logo as Strata's design-system read reports it: { assetId, url, mimeType, updatedAt }. `undefined` = this
 * Strata doesn't report a logo (leave what Plexo has alone); `null` = the project has none.
 */
export type StrataLogo = { assetId?: string; url: string };
export function parseStrataLogo(raw: unknown): StrataLogo | null | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object") return null;
  const l = raw as { url?: unknown; assetId?: unknown };
  if (typeof l.url !== "string" || !/^https:\/\//i.test(l.url)) return null;
  return { url: l.url, ...(typeof l.assetId === "string" && l.assetId ? { assetId: l.assetId } : {}) };
}

export type PublishAttempt = "published" | "unchanged" | "unavailable" | "refused";

/**
 * Publishes a project's design system in Strata (the same Publish as its Publish button) so it has a first published version and
 * its webhook starts. Needs the owner's own Strata session. `unavailable`: this Strata doesn't have the endpoint yet (404/405) or
 * couldn't be reached, so try again later. `refused`: Strata said no (not the owner, nothing saved yet, a sign-in that ran out).
 * Never throws.
 */
export async function publishStrataProject(userToken: string, projectId: string): Promise<PublishAttempt> {
  try {
    const res = await strataFetch(`/projects/${pid(projectId)}/design-system/publish`, userToken, { method: "POST", body: {} });
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { data?: { unchanged?: unknown } };
      return body.data?.unchanged === true ? "unchanged" : "published";
    }
    if (res.status === 404 || res.status === 405 || res.status >= 500 || res.status === 429) return "unavailable";
    return "refused";
  } catch {
    return "unavailable";
  }
}

async function createIntegrationKey(userToken: string, projectId: string, name: string): Promise<{ keyId: string; key: string }> {
  const res = await strataFetch(`/projects/${pid(projectId)}/integration-keys`, userToken, { method: "POST", body: { name, scope: "design-system:read" } });
  const body = (await res.json().catch(() => ({}))) as { data?: { keyId?: unknown; key?: unknown } };
  if (res.ok && typeof body.data?.keyId === "string" && typeof body.data?.key === "string") return { keyId: body.data.keyId, key: body.data.key };
  if (res.status === 401) throw new BrandError("Your Strata sign-in has run out. Reconnect Strata, then link your brand again.", 401);
  if (res.status === 403) throw new BrandError("You can see this Strata project but not change it, so Plexo can't link it. Ask its owner for edit access.", 403);
  if (res.status === 404) throw new BrandError("That Strata project wasn't found. It may have been deleted, or you may no longer have access.", 404);
  throw new BrandError("Strata couldn't link this brand right now. Please try again in a moment.", 502);
}

async function revokeIntegrationKey(userId: string, projectId: string, keyId: string): Promise<boolean> {
  try {
    const token = await loadStrataToken(userId);
    if (!token) return false;
    const res = await strataFetch(`/projects/${pid(projectId)}/integration-keys/${encodeURIComponent(keyId)}`, token, { method: "DELETE" });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- the webhook subscription (one per Strata project)

export function strataWebhookUrl(): string | null {
  const explicit = process.env.STRATA_WEBHOOK_URL?.trim();
  if (explicit) return explicit;
  const app = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  return app ? `${app}/api/v1/strata/webhook` : null;
}

/**
 * Makes sure Strata will tell Plexo when this project is published. Best effort: without it the 15-minute sweep still keeps the
 * site up to date, just more slowly — so a failure here never stops a link.
 */
export async function ensureProjectWebhook(projectId: string, credential: { token: string; createdWith: string }): Promise<boolean> {
  const url = strataWebhookUrl();
  if (!url) return false;
  try {
    const { data: existing } = await StrataProjectWebhook.get({ strataProjectId: projectId }).go();
    if (existing) return true;
    const res = await strataFetch(`/projects/${pid(projectId)}/webhooks`, credential.token, { method: "POST", body: { url, events: ["design-system.published"], description: "Plexo — keeps linked websites on brand" } });
    const body = (await res.json().catch(() => ({}))) as { data?: { webhookId?: unknown; secret?: unknown } };
    if (!res.ok || typeof body.data?.webhookId !== "string" || typeof body.data?.secret !== "string") {
      console.warn(`[site-brand] couldn't subscribe to ${projectId} (${res.status}); the scheduled check will keep it in sync`);
      return false;
    }
    await StrataProjectWebhook.upsert({ strataProjectId: projectId, webhookId: body.data.webhookId, secretCiphertext: encryptStrataToken(body.data.secret), createdWith: credential.createdWith, createdAt: now() }).go();
    return true;
  } catch (err) {
    console.warn(`[site-brand] couldn't subscribe to ${projectId}`, err);
    return false;
  }
}

/** After a site stops using a project: drop the subscription when nobody else uses it, or move it off a key that is going away. */
async function releaseProjectWebhook(projectId: string, leaving: Row): Promise<void> {
  try {
    const { data: hook } = await StrataProjectWebhook.get({ strataProjectId: projectId }).go();
    if (!hook) return;
    const { data: others } = await SiteBrand.query.byStrataProject({ strataProjectId: projectId }).go();
    const remaining = others.filter((r) => r.siteId !== leaving.siteId);
    const userToken = await loadStrataToken(leaving.userId).catch(() => null);
    const deleteWith = hook.createdWith === leaving.keyId ? decryptSafe(leaving.ciphertext) : userToken;
    if (remaining.length === 0 || hook.createdWith === leaving.keyId) {
      if (deleteWith) await strataFetch(`/projects/${pid(projectId)}/webhooks/${encodeURIComponent(hook.webhookId)}`, deleteWith, { method: "DELETE" }).catch(() => undefined);
      await StrataProjectWebhook.delete({ strataProjectId: projectId }).go();
    }
    if (remaining.length > 0 && hook.createdWith === leaving.keyId) {
      const next = remaining[0];
      const key = decryptSafe(next.ciphertext);
      if (key) await ensureProjectWebhook(projectId, { token: key, createdWith: next.keyId });
    }
  } catch (err) {
    console.warn(`[site-brand] couldn't tidy the subscription for ${projectId}`, err);
  }
}

function decryptSafe(ciphertext: string): string | null {
  try {
    return decryptStrataToken(ciphertext);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- the sheet

/** Writes the site's brand sheet from its design system. Returns the sheet's revision (what ?v= carries). */
export async function writeBrandSheet(siteId: string, ds: DesignSystem): Promise<string> {
  const body = brandStylesheet(ds);
  const revision = createHash("sha256").update(body).digest("hex").slice(0, 12);
  const css = `/* Brand for this site, from Strata${ds.strata?.projectName ? ` (${ds.strata.projectName.replace(/\*\//g, "")})` : ""}. Revision ${revision}. Use the variables below in your own code, e.g. color: var(--color-text-primary); classes: .plx-brand-button. */\n${body}`;
  await brandStore().putSheet(siteId, css);
  return revision;
}

// ---------------------------------------------------------------- reading state

async function getRow(siteId: string): Promise<Row | null> {
  const { data } = await SiteBrand.get({ siteId }).go();
  return data ?? null;
}

async function getMapping(siteId: string) {
  try {
    const { data } = await SiteBrandMapping.get({ siteId }).go();
    return data ?? null;
  } catch {
    return null;
  }
}

/** A deployed server app (own code, hosted SSR). Never throws. */
async function isServerApp(siteId: string): Promise<boolean> {
  try {
    const { DeployedApp } = await import("@/lib/db/appEntities");
    const { data } = await DeployedApp.get({ templateId: siteId }).go();
    return data?.type === "SSR";
  } catch {
    return false;
  }
}

export async function getSiteBrandState(siteId: string): Promise<SiteBrandState> {
  const [row, mapping, serverApp] = await Promise.all([getRow(siteId), getMapping(siteId), isServerApp(siteId)]);
  const canUseOnSite = Boolean(mapping && (Object.keys(mapping.colors ?? {}).length || Object.keys(mapping.fonts ?? {}).length));
  if (!row) {
    return { linked: false, projectId: null, projectName: null, autoSync: false, status: "off", updatedAt: null, lastCheckedAt: null, lastResult: null, lastResultKind: null, lastSource: null, useOnSite: Boolean(mapping?.enabled), canUseOnSite, ...(serverApp ? { serverApp, brandInApp: false } : {}), stylesheet: null, awaitingPublish: false };
  }
  return {
    linked: true,
    projectId: row.strataProjectId,
    projectName: row.projectName ?? null,
    autoSync: row.autoSync !== false,
    status: row.status,
    updatedAt: row.sheetUpdatedAt ?? null,
    lastCheckedAt: row.lastCheckedAt ?? null,
    lastResult: row.status === "needs-reconnect" ? RECONNECT_NOTE : (row.lastResult ?? null),
    lastResultKind: row.status === "needs-reconnect" ? "reconnect" : ((row.lastResultKind as BrandResultKind | undefined) ?? null),
    lastSource: (row.lastSource as BrandSource | undefined) ?? null,
    useOnSite: mapping?.enabled !== false && canUseOnSite,
    canUseOnSite,
    ...(serverApp ? { serverApp, brandInApp: row.injectServerApp === true } : {}),
    stylesheet: row.revision ? `/__plexo/brand/${siteId}.css` : null,
    awaitingPublish: row.awaitingPublish === true,
    ...(row.pendingPush === true ? { sendPending: true } : {}),
  };
}

// A page request asks for the brand link on every view; the row barely changes, so a short in-memory memo saves a read per view.
type Serving = { revision: string; mapping: { colors: Record<string, string>; fonts: Record<string, string> } | null; /** The owner switched on "add my brand to my app's pages" (absent = off, for every site that existed before it). */ serverInject: boolean };
const linkMemo = new Map<string, { at: number; value: Serving | null }>();
const LINK_MEMO_MS = 15_000;

/** What a page of this site needs at serve time: the sheet's revision (null = no brand linked) and, for raw/WordPress pages, the mapping to apply. */
export async function brandForServing(siteId: string): Promise<Serving | null> {
  const hit = linkMemo.get(siteId);
  if (hit && Date.now() - hit.at < LINK_MEMO_MS) return hit.value;
  let value: Serving | null = null;
  try {
    const row = await getRow(siteId);
    if (row?.revision) {
      const mapping = await getMapping(siteId);
      value = { revision: row.revision, mapping: mapping && mapping.enabled !== false ? { colors: mapping.colors ?? {}, fonts: mapping.fonts ?? {} } : null, serverInject: row.injectServerApp === true };
    }
  } catch (err) {
    console.warn(`[site-brand] couldn't read the brand for ${siteId}; serving without it`, err);
  }
  linkMemo.set(siteId, { at: Date.now(), value });
  if (linkMemo.size > 5000) linkMemo.delete(linkMemo.keys().next().value!);
  return value;
}
export const forgetServingMemo = (siteId?: string) => (siteId ? linkMemo.delete(siteId) : linkMemo.clear());

// ---------------------------------------------------------------- the site's design system

type SiteInfo = { id: string; name: string; organizationId: string; sourceType?: string | null; parentId?: string | null };

async function loadSite(siteId: string): Promise<SiteInfo | null> {
  const { data } = await Template.get({ id: siteId }).go();
  return data ? { id: data.id, name: data.name, organizationId: data.organizationId, sourceType: data.sourceType, parentId: data.parentId } : null;
}

const isApp = (site: SiteInfo) => site.sourceType === "REACT_PROJECT";

/** The design system the site's brand is kept in: an app's own (src/plexo-canvas), everyone else's in Plexo's brand store. */
export async function loadSiteDesignSystem(site: SiteInfo): Promise<DesignSystem | null> {
  if (isApp(site)) {
    const { listDesigns } = await import("@/lib/projects/designs");
    return (await listDesigns(site.id)).designSystem;
  }
  return brandStore().getDesignSystem(site.id);
}

/** The linked brand's design system for a site, or null — used by the page compiler so built pages match the brand too. */
export async function linkedDesignSystem(siteId: string): Promise<DesignSystem | null> {
  if (!siteId) return null;
  const row = await getRow(siteId).catch(() => null);
  if (!row) return null;
  return brandStore().getDesignSystem(siteId).catch(() => null);
}

function fromSnapshot(remote: StrataSnapshot, previous: DesignSystem | null, link: NonNullable<DesignSystem["strata"]>): DesignSystem {
  const start = previous ?? createDefaultDesignSystem();
  const next: DesignSystem = { ...start, tokens: remote.tokens, components: remote.components };
  return { ...next, strata: { ...link, base: baseOf(next) } };
}

/** Rebuilds what writes a brand INTO pages: visual-builder pages, or an app's canvas pages. Plain-language notes for the owner. */
async function rebuildPages(site: SiteInfo, ds: DesignSystem, userId: string): Promise<string[]> {
  if (isApp(site)) {
    const { applyBrandToApp } = await import("@/lib/strata/autoUpdate");
    const applied = await applyBrandToApp(site.id, userId, ds);
    return applied?.notes ?? [];
  }
  const { recompileSiteLayoutDependents } = await import("@/lib/siteLayoutCore");
  await recompileSiteLayoutDependents(site.id);
  return ["Pages built with the visual editor were rebuilt with the new components."];
}

/** Saves the design system where the site keeps it (an app's is saved without recompiling — the sheet does the work). */
async function saveSiteDesignSystem(site: SiteInfo, ds: DesignSystem, userId: string): Promise<void> {
  await brandStore().putDesignSystem(site.id, ds);
  if (isApp(site)) {
    const { applyDesignSystem } = await import("@/lib/projects/designs");
    await applyDesignSystem(site.id, ds, userId, { recompile: false });
  }
}

// ---------------------------------------------------------------- link / unlink / options

/**
 * Links a site to a Strata project (or moves it to another): needs the owner's own Strata session once. The site's pages are
 * rebuilt once so they defer to the hosted sheet; after that, brand changes never need a rebuild.
 */
export async function linkSiteBrand(input: { siteId: string; userId: string; organizationId: string; projectId: string; projectName?: string; autoSync?: boolean }): Promise<SiteBrandState> {
  const site = await loadSite(input.siteId);
  if (!site || site.organizationId !== input.organizationId || site.parentId) throw new BrandError("Site not found.", 404);
  const userToken = await loadStrataToken(input.userId);
  if (!userToken) throw new BrandError("Connect Strata first (your sign-in may have run out), then link your brand.", 401);

  const previous = await getRow(site.id);
  const { keyId, key } = await createIntegrationKey(userToken, input.projectId, `Plexo — ${site.name}`.slice(0, 80));
  // The project's own name and logo come from Strata (never from the caller), so a brand shown anywhere is what Strata says it is.
  const details = await projectDetails(userToken, input.projectId);
  let remote: Awaited<ReturnType<typeof pullPublished>>;
  try {
    remote = await pullPublished(key, input.projectId, { allowDraft: true });
  } catch (err) {
    await revokeIntegrationKey(input.userId, input.projectId, keyId);
    if (err instanceof StrataError) throw new BrandError(err.message, err.status || 502);
    throw err;
  }

  const autoSync = input.autoSync !== false;
  const projectName = details.name ?? input.projectName;
  const link = { projectId: input.projectId, projectName, syncedAt: now(), autoUpdate: autoSync };
  const ds = fromSnapshot(remote, await loadSiteDesignSystem(site).catch(() => null), link);
  await saveSiteDesignSystem(site, ds, input.userId);
  const revision = await writeBrandSheet(site.id, ds);
  await SiteBrand.upsert({
    siteId: site.id,
    organizationId: site.organizationId,
    userId: input.userId,
    strataProjectId: input.projectId,
    projectName,
    ...(remote.logo?.url || details.logo ? { projectLogo: remote.logo?.url ?? details.logo } : {}),
    ...(remote.logo?.assetId ? { projectLogoId: remote.logo.assetId } : {}),
    plexoCreated: false,
    // A server app linked from now on gets its brand link automatically (the owner linking it is the opt-in); a site that was
    // already linked keeps whatever it had, so nothing existing changes.
    injectServerApp: previous ? previous.injectServerApp === true : await isServerApp(site.id),
    awaitingPublish: remote.draft === true,
    keyId,
    ciphertext: encryptStrataToken(key),
    autoSync,
    status: "active",
    revision,
    strataRevision: remote.revision,
    sheetUpdatedAt: now(),
    lastCheckedAt: now(),
    lastResultKind: "updated",
    lastResult: remote.draft ? NOT_PUBLISHED_NOTE : "Your brand from Strata is on your site.",
    lastSource: "owner",
    createdAt: previous?.createdAt ?? now(),
  }).go();
  forgetServingMemo(site.id);

  if (previous) {
    await revokeIntegrationKey(previous.userId, previous.strataProjectId, previous.keyId);
    if (previous.strataProjectId !== input.projectId) await releaseProjectWebhook(previous.strataProjectId, previous);
  }
  await ensureProjectWebhook(input.projectId, { token: userToken, createdWith: "session" });
  // Raw-HTML and WordPress sites: match the site's own colours and fonts to the brand, if that wasn't done on import.
  if (site.sourceType === "RAW_UPLOAD" && !(await getMapping(site.id))) await refreshBrandMapping(site.id).catch(() => undefined);
  // Built pages carry their brand's values as defaults; one rebuild makes them defer to the sheet from now on.
  await rebuildPages(site, ds, input.userId).catch((err) => console.warn(`[site-brand] ${site.id}: rebuild after linking failed`, err));
  return getSiteBrandState(site.id);
}

/** A project's name and logo as Strata holds them. Best effort: linking never fails because of this. */
async function projectDetails(userToken: string, projectId: string): Promise<{ name?: string; logo?: string }> {
  const out: { name?: string; logo?: string } = {};
  const client = createStrataClient({ baseUrl: base(), getToken: () => userToken });
  try {
    const project = (await client.listProjects()).find((p) => p.id === projectId);
    if (project?.name) out.name = project.name.slice(0, 120);
    if (project?.logo && /^https:\/\//i.test(project.logo)) out.logo = project.logo;
  } catch {
    /* the name the caller gave is used */
  }
  if (!out.logo) {
    try {
      const logo = pickLogoAsset(await client.listAssets(projectId));
      if (logo) out.logo = logo.url;
    } catch {
      /* no logo shown from Strata; the site's own is used */
    }
  }
  return out;
}

// ---------------------------------------------------------------- the owner's Strata projects, and making one from a site's brand

export type StrataProjectChoice = { id: string; name: string; description?: string | null; role?: StrataProjectSummary["role"]; color?: string | null; logo?: string | null; updatedAt?: string };

/** The owner's own Strata projects (with their Strata session). `connected: false` = they haven't connected, or it ran out. */
export async function listOwnerStrataProjects(userId: string): Promise<{ available: boolean; connected: boolean; projects: StrataProjectChoice[] }> {
  const url = strataApiUrl();
  if (!url) return { available: false, connected: false, projects: [] };
  const token = await loadStrataToken(userId);
  if (!token) return { available: true, connected: false, projects: [] };
  try {
    const list = await createStrataClient({ baseUrl: url, getToken: () => token }).listProjects();
    return { available: true, connected: true, projects: list.map((p) => ({ id: p.id, name: p.name, description: p.description ?? null, role: p.role, color: p.color ?? null, logo: p.logo ?? null, updatedAt: p.updatedAt })) };
  } catch (err) {
    if (err instanceof StrataError && err.kind === "expired") return { available: true, connected: false, projects: [] };
    if (err instanceof StrataError) throw new BrandError(err.message, err.status || 502);
    throw err;
  }
}

/**
 * "Create a Strata project from my brand": makes a NEW project in the owner's Strata from the site's current brand (its main
 * colour, second colour, fonts, logo), then links the site to it with Keep in sync on, so the brand lives in Strata from then on.
 * Refuses a site that already uses a Strata project (unlink it first) or has no colours yet.
 */
export async function createStrataProjectFromSiteBrand(input: { siteId: string; userId: string; organizationId: string; name?: string; autoSync?: boolean }): Promise<{ state: SiteBrandState; project: { id: string; name: string }; sent: string[]; notes: string[] }> {
  const site = await loadSite(input.siteId);
  if (!site || site.organizationId !== input.organizationId || site.parentId) throw new BrandError("Site not found.", 404);
  const userToken = await loadStrataToken(input.userId);
  if (!userToken) throw new BrandError("Connect Strata first (your sign-in may have run out), then create your brand there.", 401);
  const brand = await resolveSiteBrand({ siteId: site.id, organizationId: site.organizationId, userId: input.userId });
  if (brand?.linked) throw new BrandError(`This website already uses ${brand.project?.name ? `"${brand.project.name}"` : "a Strata brand"}. Stop using it first if you want to make a new one.`, 409);
  const primary = brand?.colours.find((c) => c.role === "primary")?.value;
  if (!brand || !primary) throw new BrandError("Add your colours first (Brand tab, Colours and logo), then Plexo can create your brand in Strata.", 409);

  const name = (input.name ?? site.name ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || "My brand";
  const client = createStrataClient({ baseUrl: base(), getToken: () => userToken });
  let project: StrataProjectSummary;
  try {
    project = await client.createProject({ name, template: "base", brandPrimary: primary });
  } catch (err) {
    if (err instanceof StrataError) throw new BrandError(err.message, err.status || 502);
    throw err;
  }

  const sent = ["main colour"];
  const notes: string[] = [];
  try {
    const snapshot = await client.pull(project.id);
    const changed = strataPushTokens(snapshot.tokens, brand);
    if (changed.tokens.length) {
      await client.push(project.id, { variables: changed.tokens, components: [] }, snapshot.revision);
      sent.push(...changed.sent);
    }
  } catch (err) {
    notes.push("Your main colour is in Strata. Plexo couldn't send the rest (second colour and fonts) just now; add them in Strata.");
    console.warn(`[site-brand] ${site.id}: couldn't send the full brand to the new project`, err);
  }
  if (brand.logoUrl) {
    try {
      const { safeFetch } = await import("@/lib/siteImport/fetchSafe");
      const res = await safeFetch(brand.logoUrl);
      if (!res.ok) throw new Error("logo not readable");
      const file = await res.blob();
      if (file.size > 0 && file.size <= 5 * 1024 * 1024 && /^image\/(png|jpe?g|webp|svg\+xml)$/.test(file.type)) {
        const ext = file.type.includes("svg") ? "svg" : file.type.includes("png") ? "png" : file.type.includes("webp") ? "webp" : "jpg";
        await client.uploadAsset(project.id, { name: `${name} logo`, type: "LOGO", role: "PRIMARY", file, fileName: `logo.${ext}` });
        sent.push("logo");
      }
    } catch {
      notes.push("Your logo wasn't sent to Strata; add it there when you like.");
    }
  }

  // A first published version, so Strata's webhooks fire and the site follows from now on. If this Strata can't do that yet (or says
  // no), the site is linked anyway and waits for the owner's own Publish; the next refresh tries again.
  const published = await publishStrataProject(userToken, project.id);
  const live = published === "published" || published === "unchanged";
  if (!live) notes.push(WAITING_FOR_PUBLISH_NOTE);

  const state = await linkSiteBrand({ siteId: site.id, userId: input.userId, organizationId: input.organizationId, projectId: project.id, projectName: project.name, autoSync: input.autoSync });
  await SiteBrand.patch({ siteId: site.id })
    .set({
      plexoCreated: true,
      awaitingPublish: !live,
      lastResult: live ? "Your brand is now in Strata and on your site, and it stays in sync." : WAITING_FOR_PUBLISH_NOTE,
      lastResultKind: "updated",
    })
    .go()
    .catch(() => undefined);
  forgetServingMemo(site.id);
  return { state: { ...state, awaitingPublish: !live }, project: { id: project.id, name: project.name }, sent, notes };
}

/** What a new site (the new-website flow, onboarding, MCP site_create) does with the owner's choice of brand once the site exists. Never throws. */
export type NewSiteBrandChoice = { projectId?: string; projectName?: string; createFromBrand?: boolean };
export async function applyNewSiteBrandChoice(input: { siteId: string; userId: string; organizationId: string; choice: NewSiteBrandChoice | undefined }): Promise<{ ok: boolean; message?: string; project?: { id: string; name: string | null } }> {
  const c = input.choice;
  if (!c || (!c.projectId && !c.createFromBrand)) return { ok: false };
  try {
    if (c.projectId) {
      const state = await linkSiteBrand({ siteId: input.siteId, userId: input.userId, organizationId: input.organizationId, projectId: c.projectId, projectName: c.projectName, autoSync: true });
      return { ok: true, project: { id: state.projectId ?? c.projectId, name: state.projectName } };
    }
    const made = await createStrataProjectFromSiteBrand({ siteId: input.siteId, userId: input.userId, organizationId: input.organizationId });
    return { ok: true, project: made.project, message: made.notes[0] };
  } catch (err) {
    console.warn(`[site-brand] ${input.siteId}: couldn't use the chosen brand`, err);
    return { ok: false, message: err instanceof BrandError ? `${err.message} Your website is ready; you can connect the brand from its Brand page.` : "Your website is ready, but we couldn't connect your brand just now. You can do it from the website's Brand page." };
  }
}

export async function unlinkSiteBrand(input: { siteId: string; userId: string }): Promise<SiteBrandState> {
  const row = await getRow(input.siteId);
  if (row) {
    await revokeIntegrationKey(input.userId, row.strataProjectId, row.keyId) || (await revokeIntegrationKey(row.userId, row.strataProjectId, row.keyId));
    await SiteBrand.delete({ siteId: input.siteId }).go();
    await releaseProjectWebhook(row.strataProjectId, row);
    await brandStore().remove(input.siteId).catch(() => undefined);
    forgetServingMemo(input.siteId);
  }
  return getSiteBrandState(input.siteId);
}

export async function setSiteBrandOptions(input: { siteId: string; autoSync?: boolean; useOnSite?: boolean; brandInApp?: boolean }): Promise<SiteBrandState> {
  if (typeof input.brandInApp === "boolean") {
    const row = await getRow(input.siteId);
    if (!row) throw new BrandError("Link a Strata brand to this site first.", 409);
    if (!(await isServerApp(input.siteId))) throw new BrandError("This only applies to apps that run their own code on Plexo's servers.", 409);
    await SiteBrand.patch({ siteId: input.siteId }).set({ injectServerApp: input.brandInApp }).go();
  }
  if (typeof input.autoSync === "boolean") {
    const row = await getRow(input.siteId);
    if (!row) throw new BrandError("Link a Strata brand to this site first.", 409);
    await SiteBrand.patch({ siteId: input.siteId }).set({ autoSync: input.autoSync }).go();
  }
  if (typeof input.useOnSite === "boolean") {
    let mapping = await getMapping(input.siteId);
    if (input.useOnSite && !mapping) mapping = (await refreshBrandMapping(input.siteId)) ?? null;
    if (!mapping) throw new BrandError("Plexo couldn't find colours or fonts on this site to match to your brand.", 409);
    await SiteBrandMapping.patch({ siteId: input.siteId }).set({ enabled: input.useOnSite }).go();
  }
  forgetServingMemo(input.siteId);
  return getSiteBrandState(input.siteId);
}

/**
 * "Apply my brand" for a raw-HTML or WordPress site: works out (again) which of the site's own colours and fonts play which brand
 * role, from its home page and that page's stylesheets. Called on import too. Returns the saved mapping, or null when nothing
 * could be matched.
 */
export async function refreshBrandMapping(siteId: string): Promise<{ siteId: string; colors: Record<string, string>; fonts: Record<string, string>; enabled: boolean; computedAt: string } | null> {
  const { data: site } = await Template.get({ id: siteId }).go();
  if (!site || site.sourceType !== "RAW_UPLOAD") return null;
  const [{ computeBrandMapping, isEmptyMapping }, { TemplateAsset }, { fetchCssStylesheetContents }] = await Promise.all([
    import("./mapping"),
    import("@/lib/db/contentEntities"),
    import("@/lib/fetchCssAssets"),
  ]);
  const { data: assets } = await TemplateAsset.query.primary({ templateId: siteId }).go({ pages: "all" });
  const css = await fetchCssStylesheetContents(assets.filter((a) => a.path.toLowerCase().endsWith(".css")).slice(0, 20));
  const mapping = computeBrandMapping(site.compiledHtml ?? "", css);
  if (isEmptyMapping(mapping)) return null;
  const previous = await getMapping(siteId);
  const saved = { siteId, colors: mapping.colors, fonts: mapping.fonts, enabled: previous?.enabled ?? true, computedAt: now() };
  await SiteBrandMapping.upsert(saved).go();
  forgetServingMemo(siteId);
  return saved;
}

// ---------------------------------------------------------------- the sync

export type SyncOutcome = "skipped" | "busy" | "unchanged" | "updated" | "up-to-date" | "needs-review" | "needs-reconnect" | "stopped" | "error";

async function claim(siteId: string): Promise<boolean> {
  const stale = new Date(Date.now() - LOCK_STALE_MS).toISOString();
  try {
    await SiteBrand.patch({ siteId })
      .set({ runningAt: now() })
      .where((a, op) => `(${op.notExists(a.runningAt)} OR ${op.lt(a.runningAt, stale)})`)
      .go();
    return true;
  } catch (err) {
    const e = err as { name?: string; cause?: { name?: string }; message?: string };
    if (e?.name === "ConditionalCheckFailedException" || e?.cause?.name === "ConditionalCheckFailedException" || /conditional/i.test(String(e?.message))) return false;
    throw err;
  }
}

type Finish = { kind: BrandResultKind; message: string; status?: "active" | "needs-reconnect"; strataRevision?: string; revision?: string; source: BrandSource; patch?: LogoPatch };

/** Row fields a sync may change besides its result: the logo it now knows, and whether Strata still waits for a first publish. */
type LogoPatch = { projectLogo?: string; projectLogoId?: string; awaitingPublish?: boolean };

async function finish(siteId: string, f: Finish): Promise<void> {
  await SiteBrand.patch({ siteId })
    .set({
      lastCheckedAt: now(),
      lastResultKind: f.kind,
      lastResult: f.message,
      lastSource: f.source,
      ...(f.status ? { status: f.status } : {}),
      ...(f.strataRevision ? { strataRevision: f.strataRevision } : {}),
      ...(f.revision ? { revision: f.revision, sheetUpdatedAt: now() } : {}),
      ...(f.patch ?? {}),
    })
    .remove(["runningAt"])
    .go();
  forgetServingMemo(siteId);
}

/**
 * Reads the project's primary logo as Strata reports it and, when it is not the one Plexo has (a different asset or address: a logo
 * replaced in Strata), puts the new one on the site: the row's logo (what every surface reads through resolveSiteBrand) and the V2
 * header. Nothing changes, and nothing is written, when it is the same. Strata saying "no logo" (or not reporting one) leaves what the
 * site has. Never throws; a failed apply isn't recorded, so the next sync tries again.
 */
export async function syncProjectLogo(site: SiteInfo, row: Row, logo: StrataLogo | null | undefined): Promise<{ changed: boolean; note: string | null; patch: LogoPatch }> {
  const none = { changed: false, note: null, patch: {} as LogoPatch };
  if (!logo) return none;
  // A site linked before the logo was recorded has nothing to compare with. What Strata reports now is the baseline: remember it
  // and apply nothing, so a deploy never rewrites an existing site's header. Only a later, different logo is applied.
  if (!row.projectLogo && !row.projectLogoId) return { ...none, patch: { projectLogo: logo.url, ...(logo.assetId ? { projectLogoId: logo.assetId } : {}) } };
  const sameUrl = row.projectLogo === logo.url;
  const sameId = !logo.assetId || !row.projectLogoId || row.projectLogoId === logo.assetId;
  if (sameUrl && sameId) return logo.assetId && !row.projectLogoId ? { ...none, patch: { projectLogoId: logo.assetId } } : none;
  let placed = false;
  if (!isApp(site)) {
    try {
      const { applySiteLogo } = await import("@/lib/sites/applyLook");
      placed = (await applySiteLogo({ organizationId: site.organizationId, siteId: site.id, logoUrl: logo.url })).placed;
    } catch (err) {
      console.warn(`[site-brand] ${site.id}: couldn't put the new logo on the site`, err);
      return none;
    }
  }
  return { changed: true, note: placed ? NEW_LOGO_NOTE : NEW_LOGO_SAVED_NOTE, patch: { projectLogo: logo.url, ...(logo.assetId ? { projectLogoId: logo.assetId } : {}) } };
}

/** A project Plexo made that was never published: ask Strata to publish it, with the owner's own session. True when it is published now. */
async function retryFirstPublish(row: Row): Promise<boolean> {
  if (row.plexoCreated !== true) return false;
  const token = await loadStrataToken(row.userId).catch(() => null);
  if (!token) return false;
  const result = await publishStrataProject(token, row.strataProjectId);
  return result === "published" || result === "unchanged";
}

/**
 * One site's brand sync. Never throws: every problem is recorded on the site's row in words the owner can act on. Safe to run
 * twice at once (a per-site lock) and repeatedly (an unchanged Strata revision stops after one small request). `revision`, from
 * a webhook, lets an already-applied publish stop without asking Strata anything.
 */
export async function runSiteBrandUpdate(siteId: string, opts: { source: BrandSource; revision?: string; force?: boolean }): Promise<{ outcome: SyncOutcome; message?: string }> {
  let row: Row | null;
  try {
    row = await getRow(siteId);
    if (!row || row.status !== "active" || (!opts.force && row.autoSync === false)) return { outcome: "skipped" };
    if (!(await claim(siteId))) return { outcome: "busy" };
  } catch (err) {
    console.error(`[site-brand] ${siteId}: couldn't start`, err);
    return { outcome: "error", message: TRY_AGAIN_NOTE };
  }

  const source = opts.source;
  const done = async (outcome: SyncOutcome, f: Omit<Finish, "source">): Promise<{ outcome: SyncOutcome; message?: string }> => {
    await finish(siteId, { ...f, source }).catch((err) => console.error(`[site-brand] ${siteId}: couldn't record the result`, err));
    return { outcome, message: f.message };
  };

  try {
    const key = decryptSafe(row.ciphertext);
    if (!key) return await done("needs-reconnect", { kind: "reconnect", message: RECONNECT_NOTE, status: "needs-reconnect" });
    const site = await loadSite(siteId);
    if (!site) {
      await SiteBrand.delete({ siteId }).go();
      return { outcome: "stopped" };
    }

    // The sweep checks the small revision first, and so does a webhook that carries a revision already applied (a publish that only
    // changed the logo has the same revision). That one small read also reports the logo, so nothing is downloaded when nothing changed.
    const alreadyApplied = !!opts.revision && opts.revision === row.strataRevision;
    if (!opts.force && (source === "schedule" || alreadyApplied)) {
      const res = await strataFetch(`/projects/${pid(row.strataProjectId)}/design-system/revision?source=published`, key);
      if (res.status === 401) return await done("needs-reconnect", { kind: "reconnect", message: RECONNECT_NOTE, status: "needs-reconnect" });
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { data?: { revision?: unknown; logo?: unknown } };
        if (typeof body.data?.revision === "string" && body.data.revision === row.strataRevision) {
          const logo = await syncProjectLogo(site, row, parseStrataLogo(body.data.logo));
          if (!logo.changed) {
            await SiteBrand.patch({ siteId }).set({ lastCheckedAt: now(), ...logo.patch }).remove(["runningAt"]).go();
            return { outcome: "unchanged" };
          }
          return await done("updated", { kind: "updated", message: logo.note ?? NEW_LOGO_NOTE, patch: logo.patch });
        }
      }
    }

    let remote: Awaited<ReturnType<typeof pullPublished>>;
    try {
      remote = await pullPublished(key, row.strataProjectId);
    } catch (err) {
      if (!(err instanceof BrandError && err.status === 409)) throw err;
      // Never published. A project Plexo made gets one more try at publishing itself; otherwise it waits for the owner's Publish.
      if (!(await retryFirstPublish(row))) return await done("up-to-date", { kind: "up-to-date", message: WAITING_FOR_PUBLISH_NOTE, patch: { awaitingPublish: true } });
      remote = await pullPublished(key, row.strataProjectId);
    }
    const logo = await syncProjectLogo(site, row, remote.logo);
    const patch: LogoPatch = { ...logo.patch, ...(row.awaitingPublish ? { awaitingPublish: false } : {}) };
    const local = (await loadSiteDesignSystem(site)) ?? createDefaultDesignSystem();
    const link = { ...(local.strata ?? {}), projectId: row.strataProjectId, projectName: row.projectName, autoUpdate: true };
    const plan = planAutoUpdate({ local: { ...local, strata: link }, base: local.strata?.base, remote });

    if (plan.status === "up-to-date") {
      return logo.changed
        ? await done("updated", { kind: "updated", message: logo.note ?? NEW_LOGO_NOTE, strataRevision: remote.revision, patch })
        : await done("up-to-date", { kind: "up-to-date", message: "Your site matches Strata.", strataRevision: remote.revision, patch });
    }
    // Outside an app nobody edits the site's brand in Plexo, so Strata simply wins; an app's own edits get a person's eye.
    let merged = plan.merged;
    if (!merged && !isApp(site)) merged = fromSnapshot(remote, local, link);
    if (plan.status === "needs-review" && isApp(site)) return await done("needs-review", { kind: "needs-review", message: NEEDS_REVIEW_NOTE, strataRevision: remote.revision, patch });
    if (!merged) return await done("needs-review", { kind: "needs-review", message: NEEDS_REVIEW_NOTE, strataRevision: remote.revision, patch });

    const next: DesignSystem = { ...merged, strata: { ...link, ...merged.strata, syncedAt: now(), base: baseOf(merged) } };
    // Tokens alone: the sheet is all that changes. Components are written into built pages, so those are rebuilt.
    const structural = plan.plan.components.incoming.length + plan.plan.components.conflicts.length > 0 || (!plan.merged && remote.components.length !== local.components.length);
    await saveSiteDesignSystem(site, next, row.userId);
    const revision = await writeBrandSheet(siteId, next);
    const notes = [`Updated from Strata${source === "webhook" ? " when it was published" : ""}.`];
    if (logo.changed && logo.note) notes.push(logo.note);
    if (structural) notes.push(...(await rebuildPages(site, next, row.userId).catch((err) => {
      console.error(`[site-brand] ${siteId}: rebuild failed`, err);
      return ["Some pages couldn't be rebuilt with the new components — open the site and publish it to finish."];
    })));
    return await done("updated", { kind: "updated", message: notes.join(" "), strataRevision: remote.revision, revision, patch });
  } catch (err) {
    if (err instanceof StrataError && (err.kind === "expired" || err.kind === "forbidden" || err.kind === "not_found")) {
      return await done("needs-reconnect", { kind: "reconnect", message: RECONNECT_NOTE, status: "needs-reconnect" });
    }
    console.error(`[site-brand] ${siteId}: failed`, err);
    return await done("error", { kind: "error", message: TRY_AGAIN_NOTE });
  }
}

/** Every site linked to a project — what a webhook for that project updates. */
export async function sitesForProject(projectId: string): Promise<Row[]> {
  const out: Row[] = [];
  let cursor: string | null = null;
  do {
    const page: { data: Row[]; cursor: string | null } = await SiteBrand.query.byStrataProject({ strataProjectId: projectId }).go({ cursor });
    out.push(...page.data);
    cursor = page.cursor;
  } while (cursor);
  return out;
}

/** A published event for a project: update every linked site that keeps in sync, a few at a time. */
export async function applyPublishedEvent(projectId: string, revision: string | undefined): Promise<Record<string, number>> {
  const rows = (await sitesForProject(projectId)).filter((r) => r.status === "active" && r.autoSync !== false);
  const counts: Record<string, number> = {};
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, rows.length) }, async () => {
      while (next < rows.length) {
        const { siteId } = rows[next++];
        const { outcome } = await runSiteBrandUpdate(siteId, { source: "webhook", revision });
        counts[outcome] = (counts[outcome] ?? 0) + 1;
      }
    }),
  );
  return counts;
}

/** The 15-minute fallback: every linked site with "Keep in sync" on, longest-unchecked first, within a time budget. */
export async function runAllSiteBrandSyncs(opts: { concurrency?: number; budgetMs?: number } = {}): Promise<{ checked: number; counts: Record<string, number>; deferred: number }> {
  type Item = { siteId: string; strataProjectId: string; keyId: string; ciphertext: string; lastCheckedAt?: string; pendingPush?: boolean };
  const rows: Item[] = [];
  let cursor: string | null = null;
  do {
    const page: { data: Item[]; cursor: string | null } = await SiteBrand.scan.where((a, op) => `${op.eq(a.status, "active")} AND ${op.ne(a.autoSync, false)}`).go({ cursor });
    rows.push(...page.data);
    cursor = page.cursor;
  } while (cursor);
  rows.sort((a, b) => (a.lastCheckedAt ?? "").localeCompare(b.lastCheckedAt ?? ""));

  // A project whose webhook went missing (or was never made) gets one again, with one of its sites' keys.
  const projects = new Map(rows.map((r) => [r.strataProjectId, r]));
  for (const [projectId, r] of projects) {
    const key = decryptSafe(r.ciphertext);
    if (key) await ensureProjectWebhook(projectId, { token: key, createdWith: r.keyId });
  }

  const deadline = Date.now() + (opts.budgetMs ?? 4 * 60 * 1000);
  const counts: Record<string, number> = {};
  let next = 0;
  let checked = 0;
  await Promise.all(
    Array.from({ length: Math.min(opts.concurrency ?? 4, rows.length) }, async () => {
      while (next < rows.length && Date.now() < deadline) {
        const { siteId, pendingPush } = rows[next++];
        // Colours/logo the owner saved while Strata was out of reach are sent first, then the usual pull.
        if (pendingPush) await (await import("./writeThrough")).retryPendingSend(siteId).catch(() => undefined);
        const { outcome } = await runSiteBrandUpdate(siteId, { source: "schedule" });
        counts[outcome] = (counts[outcome] ?? 0) + 1;
        checked++;
      }
    }),
  );
  return { checked, counts, deferred: rows.length - checked };
}
