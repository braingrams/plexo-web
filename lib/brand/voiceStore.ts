import { Template } from "@/lib/db/contentEntities";
import { SiteBrand } from "@/lib/db/coreEntities";
import { readSiteBrand, type SiteBrand as SiteBrandShape } from "@/lib/dashboardV3/brandLook";
import { hasVoice, readSiteVoice, sanitizeVoice, voiceFromBrandContext, voiceIntoBrandContext, type BrandVoice } from "./brandVoice";

/**
 * Saving a site's brand words (tagline, short description, voice). Plexo's copy (Template.brand.voice) is saved FIRST and is what
 * every Plexo tool reads. If the site's brand is linked to a Strata project, the same words are then written to the project's
 * `brandContext` (see lib/brand/brandVoice.ts for why there); that step is best effort and never fails the save. Shared by the
 * Brand page's API and the MCP tools so both behave the same.
 */
export type VoiceSendState = "in-strata" | "not-linked" | "waiting";
export type VoiceSaveResult = { voice: BrandVoice; state: VoiceSendState; message: string };

type Who = { siteId: string; userId: string; organizationId: string };

export type VoiceDeps = {
  /** The site's saved brand record. */
  read(siteId: string): Promise<{ brand: unknown; organizationId: string } | null>;
  write(siteId: string, brand: SiteBrandShape): Promise<void>;
  link(siteId: string): Promise<{ projectId: string; userId: string } | null>;
  session(userId: string): Promise<string | null>;
  /** Reads the project's `brandContext`, merges the words in and writes it back. Throws when Strata can't be reached or says no. */
  sendToStrata(token: string, projectId: string, voice: BrandVoice): Promise<void>;
};

export const VOICE_SAVED_NOTE = "Saved. SOL and your AI helpers will now write in your voice.";
export const VOICE_IN_BRAND_NOTE = "Saved with your brand. SOL and your AI helpers will now write in your voice.";
export const VOICE_WAITING_NOTE = "Saved. SOL and your AI helpers will now write in your voice. It will also reach your brand library the next time you save.";

/** Merges `patch` over the saved words: a field that is present replaces, an empty one clears, a missing one stays. */
export function mergeVoicePatch(current: BrandVoice | undefined, patch: Record<string, unknown>): { ok: true; value: BrandVoice } | { ok: false; error: string } {
  const checked = sanitizeVoice(patch);
  if (!checked.ok) return checked;
  const next: Record<string, unknown> = { ...(current ?? {}) };
  for (const key of ["tagline", "aboutLine", "tones", "formality", "audience", "wordsLike", "wordsAvoid"] as const) {
    if (!(key in patch)) continue;
    const value = (checked.value as Record<string, unknown>)[key];
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return { ok: true, value: readSiteVoice(next) ?? {} };
}

export async function saveSiteVoice(input: Who & { patch: unknown }, deps: VoiceDeps = realVoiceDeps): Promise<VoiceSaveResult> {
  const site = await deps.read(input.siteId);
  if (!site || site.organizationId !== input.organizationId) throw new VoiceError("That site wasn't found in this account.", 404);
  if (!input.patch || typeof input.patch !== "object" || Array.isArray(input.patch)) throw new VoiceError("We couldn't read those words. Please try again.", 400);
  const own = readSiteBrand(site.brand);
  const merged = mergeVoicePatch(own?.voice, input.patch as Record<string, unknown>);
  if (!merged.ok) throw new VoiceError(merged.error, 400);
  const brand: SiteBrandShape = { ...(own ?? {}) };
  if (hasVoice(merged.value)) brand.voice = merged.value;
  else delete brand.voice;
  await deps.write(input.siteId, brand);

  let state: VoiceSendState = "not-linked";
  try {
    const link = await deps.link(input.siteId);
    if (link) {
      const token = (await deps.session(input.userId)) ?? (link.userId !== input.userId ? await deps.session(link.userId) : null);
      if (!token) state = "waiting";
      else {
        await deps.sendToStrata(token, link.projectId, merged.value);
        state = "in-strata";
      }
    }
  } catch (err) {
    console.warn(`[brand-voice] ${input.siteId}: couldn't send the words to the brand library`, err instanceof Error ? err.message : err);
    state = "waiting";
  }
  return { voice: merged.value, state, message: state === "in-strata" ? VOICE_IN_BRAND_NOTE : state === "waiting" ? VOICE_WAITING_NOTE : VOICE_SAVED_NOTE };
}

export class VoiceError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export const realVoiceDeps: VoiceDeps = {
  read: async (siteId) => {
    const { data } = await Template.get({ id: siteId }).go({ attributes: ["brand", "organizationId", "parentId"] });
    return data && !data.parentId ? { brand: data.brand, organizationId: data.organizationId } : null;
  },
  write: async (siteId, brand) => {
    await Template.patch({ id: siteId }).set({ brand }).go();
  },
  link: async (siteId) => {
    const { data } = await SiteBrand.get({ siteId }).go();
    return data ? { projectId: data.strataProjectId, userId: data.userId } : null;
  },
  session: async (userId) => {
    const { loadStrataToken } = await import("@/lib/strata/session");
    const { connectStrataInBackground } = await import("@/lib/strata/autoSetup");
    return (await loadStrataToken(userId).catch(() => null)) ?? ((await connectStrataInBackground(userId)) ? await loadStrataToken(userId).catch(() => null) : null);
  },
  sendToStrata: async (token, projectId, voice) => {
    const { strataFetch, pid } = await import("./siteBrand");
    const got = await strataFetch(`/projects/${pid(projectId)}`, token);
    if (!got.ok) throw new Error(`Strata answered ${got.status}`);
    const body = (await got.json().catch(() => ({}))) as { data?: { brandContext?: unknown } };
    const brandContext = voiceIntoBrandContext(body.data?.brandContext, voice);
    const put = await strataFetch(`/projects/${pid(projectId)}`, token, { method: "PATCH", body: { brandContext } });
    if (!put.ok) throw new Error(`Strata answered ${put.status}`);
  },
};

/**
 * The words held by the linked Strata project (a brand edited in Strata), for a site that has none of its own yet. Best effort:
 * null when nothing is linked, Strata can't be reached, or the project has no words.
 */
export async function readVoiceFromStrata(who: Who, deps: Pick<VoiceDeps, "link" | "session"> & { fetchContext?: (token: string, projectId: string) => Promise<unknown> } = realVoiceDeps): Promise<BrandVoice | null> {
  try {
    const link = await deps.link(who.siteId);
    if (!link) return null;
    const token = await deps.session(who.userId);
    if (!token) return null;
    const context = deps.fetchContext
      ? await deps.fetchContext(token, link.projectId)
      : await (async () => {
          const { strataFetch, pid } = await import("./siteBrand");
          const res = await strataFetch(`/projects/${pid(link.projectId)}`, token);
          return res.ok ? ((await res.json().catch(() => ({}))) as { data?: { brandContext?: unknown } }).data?.brandContext : null;
        })();
    return voiceFromBrandContext(context) ?? null;
  } catch {
    return null;
  }
}
