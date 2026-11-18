import { createStrataClient, planAutoUpdate, StrataError } from "@charisol/plexo-sdk/v2/strata";
import { SiteBrand, StrataAutoUpdate, User } from "@/lib/db/coreEntities";
import { Template } from "@/lib/db/contentEntities";
import { ProjectBuild } from "@/lib/db/projectEntities";
import { decryptStrataToken, encryptStrataToken } from "@/lib/crypto";
import { applyDesignSystem, listDesigns } from "@/lib/projects/designs";
import { ensureVersion, startPreview, startPublish } from "@/lib/projects/pipeline";
import { loadStrataToken } from "./session";
import { strataApiUrl } from "./server";

// "Keep my website up to date with Strata", server side, with nobody signed in.
//
// Turning it on: the owner's own Strata session creates a read-only integration key for the
// ONE linked project, and only that key (encrypted, never sent to a browser) is kept. A
// scheduled job (app/api/internal/strata-auto-update) then calls runStrataAutoUpdate for
// every app that has it on: cheap revision check -> pull -> the SDK's planAutoUpdate ->
// if safe, save the design system, recompile every page and rebuild, so visitors get the
// new brand. Anything that needs a person's eye changes nothing and leaves a plain note in
// the Design tab. Pages bake brand tokens in when they're compiled, which is why a rebuild
// (and a republish for a live site) is part of "applied".

export type AutoUpdateKind = "updated" | "up-to-date" | "needs-review" | "error" | "reconnect";
export type AutoUpdateState = {
  enabled: boolean;
  /** "active" while it's working; "needs-reconnect" when the key stopped working. */
  status: "active" | "needs-reconnect" | "off";
  lastCheckedAt: string | null;
  /** Plain language, ready to show the owner. */
  lastResult: string | null;
  lastResultKind: AutoUpdateKind | null;
};

export class AutoUpdateError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export const NEEDS_REVIEW_NOTE = "Strata has changes that need your review — open Branding in the Design tab.";
export const RECONNECT_NOTE = "Automatic updates stopped — turn them back on.";
const TRY_AGAIN_NOTE = "Couldn't check Strata just now. Plexo will try again shortly.";
const LOCK_STALE_MS = 10 * 60 * 1000;

const now = () => new Date().toISOString();

// ---------------------------------------------------------------- Strata calls

function base(): string {
  const url = strataApiUrl();
  if (!url) throw new AutoUpdateError("Strata isn't set up on this Plexo yet.", 503);
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

async function createIntegrationKey(userToken: string, projectId: string, name: string): Promise<{ keyId: string; key: string }> {
  const res = await strataFetch(`/projects/${encodeURIComponent(projectId)}/integration-keys`, userToken, { method: "POST", body: { name, scope: "design-system:read" } });
  const body = (await res.json().catch(() => ({}))) as { data?: { keyId?: unknown; key?: unknown } };
  if (res.ok && typeof body.data?.keyId === "string" && typeof body.data?.key === "string") return { keyId: body.data.keyId, key: body.data.key };
  if (res.status === 401) throw new AutoUpdateError("Your Strata sign-in has run out. Reconnect Strata, then turn this on again.", 401);
  if (res.status === 403) throw new AutoUpdateError("You can see this Strata project but not change it, so Plexo can't set up automatic updates. Ask its owner for edit access.", 403);
  if (res.status === 404) throw new AutoUpdateError("That Strata project wasn't found. It may have been deleted, or you may no longer have access.", 404);
  throw new AutoUpdateError("Strata couldn't set up automatic updates right now. Please try again in a moment.", 502);
}

/** Best effort: a key that can't be revoked right now is reported, never thrown. */
async function revokeIntegrationKey(userId: string, projectId: string, keyId: string): Promise<boolean> {
  try {
    const token = await loadStrataToken(userId);
    if (!token) return false;
    const res = await strataFetch(`/projects/${encodeURIComponent(projectId)}/integration-keys/${encodeURIComponent(keyId)}`, token, { method: "DELETE" });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- records

type Row = NonNullable<Awaited<ReturnType<ReturnType<typeof StrataAutoUpdate.get>["go"]>>["data"]>;

async function getRow(appId: string): Promise<Row | null> {
  const { data } = await StrataAutoUpdate.get({ appId }).go();
  return data ?? null;
}

export async function getAutoUpdateState(appId: string): Promise<AutoUpdateState> {
  const row = await getRow(appId);
  if (!row) return { enabled: false, status: "off", lastCheckedAt: null, lastResult: null, lastResultKind: null };
  return {
    enabled: true,
    status: row.status,
    lastCheckedAt: row.lastCheckedAt ?? null,
    lastResult: row.status === "needs-reconnect" ? RECONNECT_NOTE : (row.lastResult ?? null),
    lastResultKind: row.status === "needs-reconnect" ? "reconnect" : ((row.lastResultKind as AutoUpdateKind | undefined) ?? null),
  };
}

// ---------------------------------------------------------------- turn on / off

/**
 * Turns automatic updates on for an app linked to a Strata project: creates the read-only key
 * with the owner's Strata session, stores it encrypted, and sets autoUpdate on the design
 * system's link. Safe to call again (the old key is replaced).
 */
export async function enableAutoUpdate(input: { appId: string; appName: string; userId: string }): Promise<AutoUpdateState> {
  const { designSystem } = await listDesigns(input.appId);
  const projectId = designSystem.strata?.projectId;
  if (!projectId) throw new AutoUpdateError("Link this site to a Strata project in Branding first, then turn on automatic updates.", 409);
  const userToken = await loadStrataToken(input.userId);
  if (!userToken) throw new AutoUpdateError("Connect Strata first (your sign-in may have run out), then turn this on again.", 401);

  const previous = await getRow(input.appId);
  const { keyId, key } = await createIntegrationKey(userToken, projectId, `Plexo — ${input.appName}`.slice(0, 80));
  try {
    await StrataAutoUpdate.upsert({
      appId: input.appId,
      userId: input.userId,
      strataProjectId: projectId,
      keyId,
      ciphertext: encryptStrataToken(key),
      status: "active",
      createdAt: now(),
    }).go();
    await StrataAutoUpdate.patch({ appId: input.appId }).remove(["lastCheckedAt", "lastRevision", "lastResultKind", "lastResult", "runningAt"]).go();
    await applyDesignSystem(input.appId, { ...designSystem, strata: { ...designSystem.strata, projectId, autoUpdate: true } }, input.userId, { recompile: false });
  } catch (err) {
    // Don't leave a working key behind for a switch that didn't turn on.
    await revokeIntegrationKey(input.userId, projectId, keyId);
    await (previous ? StrataAutoUpdate.upsert(previous).go() : StrataAutoUpdate.delete({ appId: input.appId }).go()).catch(() => undefined);
    throw err;
  }
  if (previous) await revokeIntegrationKey(previous.userId, previous.strataProjectId, previous.keyId);
  return getAutoUpdateState(input.appId);
}

/** Turns it off: revokes the key in Strata (best effort), forgets it, clears the setting. */
export async function disableAutoUpdate(input: { appId: string; userId: string }): Promise<AutoUpdateState> {
  const row = await getRow(input.appId);
  if (row) {
    await revokeIntegrationKey(row.userId, row.strataProjectId, row.keyId);
    await StrataAutoUpdate.delete({ appId: input.appId }).go();
  }
  await clearFlag(input.appId, input.userId);
  return getAutoUpdateState(input.appId);
}

async function clearFlag(appId: string, userId?: string): Promise<void> {
  try {
    const { designSystem } = await listDesigns(appId);
    if (designSystem.strata?.autoUpdate) await applyDesignSystem(appId, { ...designSystem, strata: { ...designSystem.strata, autoUpdate: false } }, userId, { recompile: false });
  } catch (err) {
    console.warn(`[strata-auto-update] couldn't clear the setting for ${appId}:`, err);
  }
}

/** When an app is deleted: revoke the key and drop the record, best effort. */
export async function removeAutoUpdateForApp(appId: string): Promise<void> {
  const row = await getRow(appId);
  if (!row) return;
  await revokeIntegrationKey(row.userId, row.strataProjectId, row.keyId);
  await StrataAutoUpdate.delete({ appId }).go();
}

/** Stops quietly because the owner changed the link or switched the setting off elsewhere. */
async function stopAndForget(row: Row): Promise<void> {
  await revokeIntegrationKey(row.userId, row.strataProjectId, row.keyId);
  await StrataAutoUpdate.delete({ appId: row.appId }).go();
}

// ---------------------------------------------------------------- the job

export type RunOutcome = "skipped" | "busy" | "unchanged" | "updated" | "up-to-date" | "needs-review" | "needs-reconnect" | "stopped" | "error";
export type RunResult = { outcome: RunOutcome; message?: string };

async function claim(appId: string): Promise<boolean> {
  const stale = new Date(Date.now() - LOCK_STALE_MS).toISOString();
  try {
    await StrataAutoUpdate.patch({ appId })
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

async function managedBySiteBrand(appId: string): Promise<boolean> {
  try {
    const { data } = await SiteBrand.get({ siteId: appId }).go();
    return Boolean(data?.autoSync);
  } catch {
    return false;
  }
}

type Finish = { kind: AutoUpdateKind; message: string; status?: "active" | "needs-reconnect"; revision?: string };

async function finish(appId: string, f: Finish): Promise<void> {
  const patch = StrataAutoUpdate.patch({ appId })
    .set({ lastCheckedAt: now(), lastResultKind: f.kind, lastResult: f.message, ...(f.status ? { status: f.status } : {}), ...(f.revision ? { lastRevision: f.revision } : {}) })
    .remove(["runningAt"]);
  await patch.go();
}

/**
 * One app's automatic update. Never throws: every problem is recorded on the app's row in
 * words the owner can act on. Safe to run twice at once (a per-app lock) or repeatedly (an
 * unchanged Strata revision stops after one small request).
 */
export async function runStrataAutoUpdate(appId: string): Promise<RunResult> {
  let row: Row | null;
  try {
    row = await getRow(appId);
    if (!row || row.status !== "active") return { outcome: "skipped" };
    // A site-level brand link (lib/brand/siteBrand.ts) now keeps this app up to date: don't apply the same change twice.
    if (await managedBySiteBrand(appId)) return { outcome: "skipped" };
    if (!(await claim(appId))) return { outcome: "busy" };
  } catch (err) {
    console.error(`[strata-auto-update] ${appId}: couldn't start`, err);
    return { outcome: "error", message: TRY_AGAIN_NOTE };
  }

  const done = async (outcome: RunOutcome, f: Finish): Promise<RunResult> => {
    await finish(appId, f).catch((err) => console.error(`[strata-auto-update] ${appId}: couldn't record the result`, err));
    return { outcome, message: f.message };
  };

  try {
    let key: string;
    try {
      key = decryptStrataToken(row.ciphertext);
    } catch {
      return await done("needs-reconnect", { kind: "reconnect", message: RECONNECT_NOTE, status: "needs-reconnect" });
    }

    // The owner may have switched it off in the editor, or linked another project.
    const { designSystem } = await listDesigns(appId);
    const link = designSystem.strata;
    if (!link || link.autoUpdate !== true || link.projectId !== row.strataProjectId) {
      await stopAndForget(row);
      return { outcome: "stopped" };
    }

    const projectId = encodeURIComponent(row.strataProjectId);
    const revisionRes = await strataFetch(`/projects/${projectId}/design-system/revision`, key);
    if (revisionRes.status === 401 || revisionRes.status === 404) {
      return await done("needs-reconnect", { kind: "reconnect", message: RECONNECT_NOTE, status: "needs-reconnect" });
    }
    if (!revisionRes.ok) return await done("error", { kind: "error", message: TRY_AGAIN_NOTE });
    const revisionBody = (await revisionRes.json().catch(() => ({}))) as { data?: { revision?: unknown } };
    const revision = typeof revisionBody.data?.revision === "string" ? revisionBody.data.revision : undefined;
    const settled = row.lastResultKind === "updated" || row.lastResultKind === "up-to-date";
    if (revision && revision === row.lastRevision && settled) {
      await StrataAutoUpdate.patch({ appId }).set({ lastCheckedAt: now() }).remove(["runningAt"]).go();
      return { outcome: "unchanged" };
    }

    const remote = await createStrataClient({ baseUrl: base(), getToken: () => key }).pull(row.strataProjectId);
    const plan = planAutoUpdate({ local: designSystem, base: link.base, remote });
    const seen = remote.revision ?? revision;

    if (plan.status === "up-to-date") return await done("up-to-date", { kind: "up-to-date", message: "Your site matches Strata.", revision: seen });
    if (plan.status === "needs-review" || !plan.merged) return await done("needs-review", { kind: "needs-review", message: NEEDS_REVIEW_NOTE, revision: seen });

    const applied = await applyBrandToApp(appId, row.userId, { ...plan.merged, strata: { ...plan.merged.strata, projectId: row.strataProjectId, autoUpdate: true } });
    if (!applied) {
      await stopAndForget(row);
      return { outcome: "stopped" };
    }
    const notes = applied.notes;
    return await done("updated", { kind: "updated", message: notes.join(" "), revision: seen });
  } catch (err) {
    if (err instanceof StrataError && err.kind === "expired") return await done("needs-reconnect", { kind: "reconnect", message: RECONNECT_NOTE, status: "needs-reconnect" });
    console.error(`[strata-auto-update] ${appId}: failed`, err);
    return await done("error", { kind: "error", message: TRY_AGAIN_NOTE });
  }
}

/**
 * Saves a new design system into an app, recompiles its canvas pages and rebuilds — and, when the live site is exactly the
 * latest saved version, republishes it, so visitors get the new brand without anyone opening the editor. Returns plain-language
 * notes for the owner, or null when the app is gone. Shared by this job and the site-level brand sync (lib/brand/siteBrand.ts).
 */
export async function applyBrandToApp(appId: string, userId: string, designSystem: Parameters<typeof applyDesignSystem>[1]): Promise<{ notes: string[] } | null> {
  // Snapshot any unsaved work first so we can tell whether a republish would also push out changes the owner hasn't published yet.
  const { data: template } = await Template.get({ id: appId }).go();
  if (!template) return null;
  const actor = { userId, organizationId: template.organizationId, userName: (await User.get({ id: userId }).go({ attributes: ["name"] })).data?.name ?? undefined };
  let liveVersionId: string | null = null;
  if (template.liveBuildId) {
    const [{ versionId: headVersionId }, live] = await Promise.all([
      ensureVersion(appId, { message: "Saved before updating the brand from Strata", source: "editor", authorId: actor.userId, authorName: actor.userName }),
      ProjectBuild.get({ id: template.liveBuildId }).go(),
    ]);
    liveVersionId = live.data?.versionId && live.data.versionId === headVersionId ? headVersionId : null;
  }

  const applied = await applyDesignSystem(appId, designSystem, userId);

  const notes: string[] = [`Strata's latest brand was applied to ${applied.recompiled.length} page${applied.recompiled.length === 1 ? "" : "s"}.`];
  if (applied.skipped.length) notes.push(`${applied.skipped.join(", ")} ${applied.skipped.length === 1 ? "was" : "were"} edited in code, so ${applied.skipped.length === 1 ? "it was" : "they were"} left as they are.`);
  try {
    await startPreview(appId, actor, { message: "Updated brand from Strata", source: "editor" });
    if (template.liveBuildId && liveVersionId) {
      await startPublish(appId, actor);
      notes.push("Your live site is being updated.");
    } else if (template.liveBuildId) {
      notes.push("Your preview is updated. Publish when you're ready — you have other changes that aren't live yet.");
    } else {
      notes.push("Your preview is updated.");
    }
  } catch (err) {
    console.error(`[strata-auto-update] ${appId}: rebuild didn't start`, err);
    notes.push("Rebuilding didn't start — open the app and press Build to finish.");
  }
  return { notes };
}

/** The scheduled sweep: every app with automatic updates on, a few at a time, within a time budget. */
export async function runAllStrataAutoUpdates(opts: { concurrency?: number; budgetMs?: number } = {}): Promise<{ checked: number; counts: Record<string, number>; deferred: number }> {
  type Item = { appId: string; lastCheckedAt?: string };
  const rows: Item[] = [];
  let cursor: string | null = null;
  do {
    const page: { data: Item[]; cursor: string | null } = await StrataAutoUpdate.scan.where((a, op) => op.eq(a.status, "active")).go({ cursor });
    rows.push(...page.data);
    cursor = page.cursor;
  } while (cursor);
  // Longest-unchecked first, so a busy sweep that runs out of time never starves the same apps.
  rows.sort((a, b) => (a.lastCheckedAt ?? "").localeCompare(b.lastCheckedAt ?? ""));

  const deadline = Date.now() + (opts.budgetMs ?? 4 * 60 * 1000);
  const counts: Record<string, number> = {};
  let next = 0;
  let checked = 0;
  const workers = Array.from({ length: Math.min(opts.concurrency ?? 4, rows.length) }, async () => {
    while (next < rows.length && Date.now() < deadline) {
      const { appId } = rows[next++];
      const { outcome } = await runStrataAutoUpdate(appId);
      counts[outcome] = (counts[outcome] ?? 0) + 1;
      checked++;
    }
  });
  await Promise.all(workers);
  return { checked, counts, deferred: rows.length - checked };
}
