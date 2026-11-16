import { createHash } from "node:crypto";
import { brandStylesheet, createDefaultDesignSystem, type DesignSystem } from "@charisol/plexo-sdk/v2/compile";
import { baseOf, componentFromStrata, planAutoUpdate, StrataError, tokenFromStrata, type StrataSnapshot } from "@charisol/plexo-sdk/v2/strata";
import { SiteBrand, SiteBrandMapping, StrataProjectWebhook } from "@/lib/db/coreEntities";
import { Template } from "@/lib/db/contentEntities";
import { decryptStrataToken, encryptStrataToken } from "@/lib/crypto";
import { loadStrataToken } from "@/lib/strata/session";
import { strataApiUrl } from "@/lib/strata/apiUrl";
import { brandStore } from "./store";

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
  /** The address of the hosted brand sheet, for an owner's own code (apps, server apps). */
  stylesheet: string | null;
};

export class BrandError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export const RECONNECT_NOTE = "Plexo lost access to this Strata project. Link it again to keep your brand up to date.";
export const NEEDS_REVIEW_NOTE = "Strata has changes that need a look before they go live — open Branding in the editor.";
const TRY_AGAIN_NOTE = "Couldn't reach Strata just now. Plexo will try again in a few minutes.";
const NOT_PUBLISHED_NOTE = "This Strata project hasn't been published yet, so Plexo used its latest saved version. Publish it in Strata and your site will follow.";
const LOCK_STALE_MS = 10 * 60 * 1000;

const now = () => new Date().toISOString();

type Row = NonNullable<Awaited<ReturnType<ReturnType<typeof SiteBrand.get>["go"]>>["data"]>;

// ---------------------------------------------------------------- Strata calls

function base(): string {
  const url = strataApiUrl();
  if (!url) throw new BrandError("Strata isn't set up on this Plexo yet.", 503);
  return url;
}

async function strataFetch(path: string, token: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
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

const pid = (projectId: string) => encodeURIComponent(projectId);

/**
 * The design system as last PUBLISHED in Strata (never in-progress edits). `allowDraft` (linking only) falls back to the latest
 * saved version for a project that has never been published, so linking always shows something.
 */
export async function pullPublished(token: string, projectId: string, opts: { allowDraft?: boolean } = {}): Promise<StrataSnapshot & { draft?: boolean }> {
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
  const body = (await res.json().catch(() => ({}))) as { data?: { revision?: string; variables?: unknown[]; components?: unknown[] } };
  const d = body.data ?? {};
  return {
    revision: typeof d.revision === "string" ? d.revision : undefined,
    tokens: (Array.isArray(d.variables) ? d.variables : []).map((v) => tokenFromStrata(v as Record<string, unknown>)),
    components: (Array.isArray(d.components) ? d.components : []).map((c) => componentFromStrata(c as Record<string, unknown>)),
    ...(draft ? { draft: true } : {}),
  };
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

export async function getSiteBrandState(siteId: string): Promise<SiteBrandState> {
  const [row, mapping] = await Promise.all([getRow(siteId), getMapping(siteId)]);
  const canUseOnSite = Boolean(mapping && (Object.keys(mapping.colors ?? {}).length || Object.keys(mapping.fonts ?? {}).length));
  if (!row) {
    return { linked: false, projectId: null, projectName: null, autoSync: false, status: "off", updatedAt: null, lastCheckedAt: null, lastResult: null, lastResultKind: null, lastSource: null, useOnSite: Boolean(mapping?.enabled), canUseOnSite, stylesheet: null };
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
    stylesheet: row.revision ? `/__plexo/brand/${siteId}.css` : null,
  };
}

// A page request asks for the brand link on every view; the row barely changes, so a short in-memory memo saves a read per view.
const linkMemo = new Map<string, { at: number; value: { revision: string; mapping: { colors: Record<string, string>; fonts: Record<string, string> } | null } | null }>();
const LINK_MEMO_MS = 15_000;

/** What a page of this site needs at serve time: the sheet's revision (null = no brand linked) and, for raw/WordPress pages, the mapping to apply. */
export async function brandForServing(siteId: string): Promise<{ revision: string; mapping: { colors: Record<string, string>; fonts: Record<string, string> } | null } | null> {
  const hit = linkMemo.get(siteId);
  if (hit && Date.now() - hit.at < LINK_MEMO_MS) return hit.value;
  let value: { revision: string; mapping: { colors: Record<string, string>; fonts: Record<string, string> } | null } | null = null;
  try {
    const row = await getRow(siteId);
    if (row?.revision) {
      const mapping = await getMapping(siteId);
      value = { revision: row.revision, mapping: mapping && mapping.enabled !== false ? { colors: mapping.colors ?? {}, fonts: mapping.fonts ?? {} } : null };
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
  let remote: Awaited<ReturnType<typeof pullPublished>>;
  try {
    remote = await pullPublished(key, input.projectId, { allowDraft: true });
  } catch (err) {
    await revokeIntegrationKey(input.userId, input.projectId, keyId);
    if (err instanceof StrataError) throw new BrandError(err.message, err.status || 502);
    throw err;
  }

  const autoSync = input.autoSync !== false;
  const link = { projectId: input.projectId, projectName: input.projectName, syncedAt: now(), autoUpdate: autoSync };
  const ds = fromSnapshot(remote, await loadSiteDesignSystem(site).catch(() => null), link);
  await saveSiteDesignSystem(site, ds, input.userId);
  const revision = await writeBrandSheet(site.id, ds);
  await SiteBrand.upsert({
    siteId: site.id,
    organizationId: site.organizationId,
    userId: input.userId,
    strataProjectId: input.projectId,
    projectName: input.projectName,
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

export async function setSiteBrandOptions(input: { siteId: string; autoSync?: boolean; useOnSite?: boolean }): Promise<SiteBrandState> {
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

type Finish = { kind: BrandResultKind; message: string; status?: "active" | "needs-reconnect"; strataRevision?: string; revision?: string; source: BrandSource };

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
    })
    .remove(["runningAt"])
    .go();
  forgetServingMemo(siteId);
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
    if (opts.revision && opts.revision === row.strataRevision && !opts.force) return { outcome: "unchanged" };
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

    // The sweep checks the small revision first; a webhook already told us there's something new.
    if (source === "schedule" && !opts.force) {
      const res = await strataFetch(`/projects/${pid(row.strataProjectId)}/design-system/revision?source=published`, key);
      if (res.status === 401) return await done("needs-reconnect", { kind: "reconnect", message: RECONNECT_NOTE, status: "needs-reconnect" });
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { data?: { revision?: unknown } };
        if (typeof body.data?.revision === "string" && body.data.revision === row.strataRevision) {
          await SiteBrand.patch({ siteId }).set({ lastCheckedAt: now() }).remove(["runningAt"]).go();
          return { outcome: "unchanged" };
        }
      }
    }

    let remote: StrataSnapshot;
    try {
      remote = await pullPublished(key, row.strataProjectId);
    } catch (err) {
      if (err instanceof BrandError && err.status === 409) return await done("up-to-date", { kind: "up-to-date", message: "Waiting for the first publish in Strata." });
      throw err;
    }
    const local = (await loadSiteDesignSystem(site)) ?? createDefaultDesignSystem();
    const link = { ...(local.strata ?? {}), projectId: row.strataProjectId, projectName: row.projectName, autoUpdate: true };
    const plan = planAutoUpdate({ local: { ...local, strata: link }, base: local.strata?.base, remote });

    if (plan.status === "up-to-date") return await done("up-to-date", { kind: "up-to-date", message: "Your site matches Strata.", strataRevision: remote.revision });
    // Outside an app nobody edits the site's brand in Plexo, so Strata simply wins; an app's own edits get a person's eye.
    let merged = plan.merged;
    if (!merged && !isApp(site)) merged = fromSnapshot(remote, local, link);
    if (plan.status === "needs-review" && isApp(site)) return await done("needs-review", { kind: "needs-review", message: NEEDS_REVIEW_NOTE, strataRevision: remote.revision });
    if (!merged) return await done("needs-review", { kind: "needs-review", message: NEEDS_REVIEW_NOTE, strataRevision: remote.revision });

    const next: DesignSystem = { ...merged, strata: { ...link, ...merged.strata, syncedAt: now(), base: baseOf(merged) } };
    // Tokens alone: the sheet is all that changes. Components are written into built pages, so those are rebuilt.
    const structural = plan.plan.components.incoming.length + plan.plan.components.conflicts.length > 0 || (!plan.merged && remote.components.length !== local.components.length);
    await saveSiteDesignSystem(site, next, row.userId);
    const revision = await writeBrandSheet(siteId, next);
    const notes = [`Updated from Strata${source === "webhook" ? " when it was published" : ""}.`];
    if (structural) notes.push(...(await rebuildPages(site, next, row.userId).catch((err) => {
      console.error(`[site-brand] ${siteId}: rebuild failed`, err);
      return ["Some pages couldn't be rebuilt with the new components — open the site and publish it to finish."];
    })));
    return await done("updated", { kind: "updated", message: notes.join(" "), strataRevision: remote.revision, revision });
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
  type Item = { siteId: string; strataProjectId: string; keyId: string; ciphertext: string; lastCheckedAt?: string };
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
        const { siteId } = rows[next++];
        const { outcome } = await runSiteBrandUpdate(siteId, { source: "schedule" });
        counts[outcome] = (counts[outcome] ?? 0) + 1;
        checked++;
      }
    }),
  );
  return { checked, counts, deferred: rows.length - checked };
}
