import { createStrataClient } from "@charisol/plexo-sdk/v2/strata";
import { SiteBrand } from "@/lib/db/coreEntities";
import { Template } from "@/lib/db/contentEntities";
import { readSiteBrand } from "@/lib/dashboardV3/brandLook";
import { loadStrataToken } from "@/lib/strata/session";
import { strataApiUrl } from "@/lib/strata/apiUrl";
import { connectStrataInBackground, ensureSiteBrandInStrata } from "@/lib/strata/autoSetup";
import { publishStrataProject, runSiteBrandUpdate } from "./siteBrand";
import { strataPushPrimary, strataPushTokens } from "./brandModel";
import { flushWaitingExtras } from "./extrasWriteThrough";

/**
 * The brand lives in Strata. When someone changes their colours or logo in Plexo, the change is saved on the site first (Plexo's
 * own copy, which keeps the site looking right if Strata is down) and then sent to the site's Strata project, which every surface
 * follows. If Strata can't be reached the copy stays, the site is marked "waiting to send", and it is sent on the next save, by the
 * 15-minute sweep, or when the owner presses "Send to Strata". Never throws.
 */
export type SendState = "in-strata" | "created" | "waiting" | "not-set-up";
export type SendResult = { state: SendState; message: string; projectName?: string };

export const SENT_NOTE = "Your brand is saved. Your website follows it.";
export const WAITING_NOTE = "Saved here. Your brand will finish saving by itself; you can also press “Save now”.";

export type LocalBrand = { colors: string[]; logoUrl?: string };
type LinkRow = { projectId: string; userId: string; projectLogo?: string | null };

export type WriteDeps = {
  localBrand(siteId: string): Promise<LocalBrand | null>;
  link(siteId: string): Promise<LinkRow | null>;
  session(userId: string): Promise<string | null>;
  push(token: string, projectId: string, brand: LocalBrand): Promise<void>;
  uploadLogo(token: string, projectId: string, siteName: string, logoUrl: string): Promise<void>;
  publish(token: string, projectId: string): Promise<"published" | "unchanged" | "unavailable" | "refused">;
  setPending(siteId: string, pending: boolean, error?: string): Promise<void>;
  refreshSite(siteId: string): Promise<void>;
  create(input: { siteId: string; userId: string; organizationId: string }): Promise<{ status: string; projectName?: string }>;
  siteName(siteId: string): Promise<string>;
};

export async function sendBrandToStrata(input: { siteId: string; userId: string; organizationId: string }, deps: WriteDeps = realDeps): Promise<SendResult> {
  try {
    const brand = await deps.localBrand(input.siteId);
    const link = await deps.link(input.siteId);
    if (!link) {
      // Not in Strata yet (a new site, or an earlier attempt didn't get through): make its project from the saved brand now.
      const made = await deps.create(input);
      if (made.status === "created") return { state: "created", message: `Your brand is saved${made.projectName ? ` as "${made.projectName}"` : ""}. Your website follows it.`, projectName: made.projectName };
      if (made.status === "already-linked") return sendBrandToStrata(input, deps);
      return { state: "waiting", message: WAITING_NOTE };
    }
    if (!brand) return { state: "in-strata", message: SENT_NOTE };
    const token = (await deps.session(input.userId)) ?? (link.userId && link.userId !== input.userId ? await deps.session(link.userId) : null);
    if (!token) {
      await deps.setPending(input.siteId, true, "No Strata session");
      return { state: "waiting", message: WAITING_NOTE };
    }
    await deps.push(token, link.projectId, brand);
    if (brand.logoUrl && brand.logoUrl !== link.projectLogo) await deps.uploadLogo(token, link.projectId, await deps.siteName(input.siteId), brand.logoUrl);
    const published = await deps.publish(token, link.projectId);
    if (published === "unavailable" || published === "refused") {
      await deps.setPending(input.siteId, true, "Strata did not publish");
      return { state: "waiting", message: WAITING_NOTE };
    }
    await deps.setPending(input.siteId, false);
    await deps.refreshSite(input.siteId);
    return { state: "in-strata", message: SENT_NOTE };
  } catch (err) {
    console.warn(`[brand-send] ${input.siteId}: couldn't send to Strata`, err instanceof Error ? err.message : err);
    await deps.setPending(input.siteId, true, err instanceof Error ? err.message.slice(0, 200) : "failed").catch(() => undefined);
    return { state: "waiting", message: WAITING_NOTE };
  }
}

const realDeps: WriteDeps = {
  localBrand: async (siteId) => {
    const { data: site } = await Template.get({ id: siteId }).go();
    const b = readSiteBrand(site?.brand);
    return b?.colors?.length ? { colors: b.colors, logoUrl: b.logoUrl } : null;
  },
  link: async (siteId) => {
    const { data } = await SiteBrand.get({ siteId }).go();
    return data ? { projectId: data.strataProjectId, userId: data.userId, projectLogo: data.projectLogo ?? null } : null;
  },
  session: async (userId) => (await loadStrataToken(userId).catch(() => null)) ?? ((await connectStrataInBackground(userId)) ? await loadStrataToken(userId).catch(() => null) : null),
  push: async (token, projectId, brand) => {
    const base = strataApiUrl();
    if (!base) throw new Error("Saving your brand isn't available on this Plexo yet.");
    const client = createStrataClient({ baseUrl: base, getToken: () => token });
    const snapshot = await client.pull(projectId);
    const colours = brand.colors.map((value, i) => ({ role: i === 0 ? "primary" : i === 1 ? "secondary" : "accent", label: "", value })) as never;
    const first = strataPushPrimary(snapshot.tokens, brand.colors[0]);
    const rest = strataPushTokens(first.tokens.length ? snapshot.tokens.map((t) => first.tokens.find((n) => n.key === t.key) ?? t) : snapshot.tokens, { colours, fonts: {} });
    const changed = [...first.tokens, ...rest.tokens];
    if (changed.length) await client.push(projectId, { variables: changed, components: [] }, snapshot.revision);
  },
  uploadLogo: async (token, projectId, siteName, logoUrl) => {
    const base = strataApiUrl();
    if (!base) return;
    const { safeFetch } = await import("@/lib/siteImport/fetchSafe");
    const res = await safeFetch(logoUrl);
    if (!res.ok) return;
    const file = await res.blob();
    if (file.size <= 0 || file.size > 5 * 1024 * 1024 || !/^image\/(png|jpe?g|webp|svg\+xml)$/.test(file.type)) return;
    const ext = file.type.includes("svg") ? "svg" : file.type.includes("png") ? "png" : file.type.includes("webp") ? "webp" : "jpg";
    await createStrataClient({ baseUrl: base, getToken: () => token }).uploadAsset(projectId, { name: `${siteName} logo`, type: "LOGO", role: "PRIMARY", file, fileName: `logo.${ext}` });
  },
  publish: (token, projectId) => publishStrataProject(token, projectId),
  setPending: async (siteId, pending, error) => {
    // Something else (components, tokens) may still be waiting: the site stays "waiting to send" until all of it is through.
    const { data: row } = await SiteBrand.get({ siteId }).go().catch(() => ({ data: null }));
    const extras = !!(row?.pendingComponents || row?.pendingTokens);
    await SiteBrand.patch({ siteId }).set({ pendingPush: pending || extras, pendingBrand: pending, pushError: pending ? error ?? "failed" : "", pushTriedAt: new Date().toISOString() }).go().catch(() => undefined);
  },
  refreshSite: async (siteId) => {
    await runSiteBrandUpdate(siteId, { source: "owner", force: true });
  },
  create: (input) => ensureSiteBrandInStrata(input),
  siteName: async (siteId) => (await Template.get({ id: siteId }).go()).data?.name ?? "Website",
};

/** Sends whatever is waiting for one site (used by the sweep): components and token changes first, then colours/logo if those are waiting. */
export async function retryPendingSend(siteId: string): Promise<SendResult | null> {
  const { data: row } = await SiteBrand.get({ siteId }).go();
  if (!row || row.pendingPush !== true) return null;
  const who = { siteId, userId: row.userId, organizationId: row.organizationId };
  const extras = !!(row.pendingComponents || row.pendingTokens);
  if (extras) await flushWaitingExtras(who).catch(() => undefined);
  // Rows from before components and tokens existed are pendingPush with no marker: that is the colours/logo.
  if (extras && row.pendingBrand !== true) return null;
  return sendBrandToStrata(who);
}

/**
 * Sends within `ms` so saving a look never feels slow. If Strata is slower than that, the site is marked "waiting to send"
 * (the send carries on, and the sweep or the next save finishes it if it does not).
 */
export async function sendBrandWithin(input: { siteId: string; userId: string; organizationId: string }, ms = 8000): Promise<SendResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  // Components and token changes that were waiting go first (a no-op when nothing is).
  await flushWaitingExtras(input).catch(() => undefined);
  const result = await Promise.race([sendBrandToStrata(input), slow]);
  if (timer) clearTimeout(timer);
  if (result) return result;
  await realDeps.setPending(input.siteId, true, "Strata was slow to answer");
  return { state: "waiting", message: WAITING_NOTE };
}
