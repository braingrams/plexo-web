import type { DesignSystem } from "@charisol/plexo-sdk/v2/compile";
import { SiteBrand } from "@/lib/db/coreEntities";
import { loadStrataToken } from "@/lib/strata/session";
import { connectStrataInBackground } from "@/lib/strata/autoSetup";
import { planTokenChanges, type TokenRequest } from "./brandModel";
import { mergeComponentRows, type DesignComponent } from "./brandComponents";

/**
 * Components and token changes (fonts, corners, spacing, colours) made in Plexo (by SOL, or by an AI over MCP) go to the site's Strata
 * project the same way colours and the logo do (lib/brand/writeThrough.ts): Plexo's own copy is saved first, the change is sent to
 * Strata and published, Plexo's copy is then refreshed from what Strata holds. If Strata can't be reached the change is KEPT on the
 * site's row ("waiting to send") and sent on the next save, by the 15-minute sweep, or from the "Send to Strata" button. Never throws.
 */
export type ExtrasState = "in-strata" | "waiting" | "not-set-up" | "refused";
export type ComponentSendResult = { state: ExtrasState; message: string; created: string[]; updated: string[] };
export type TokenSendResult = { state: ExtrasState; message: string; changed: string[]; skipped: string[] };

export const COMPONENT_SENT_NOTE = "Your brand is saved. It's live on your website.";
export const WAITING_EXTRAS_NOTE = "Saved here. Your brand will finish saving by itself; you can also press “Save now”.";
export const NOT_IN_STRATA_NOTE = "This site's brand isn't saved yet. Open Your brand on the site and it saves itself; then try again.";

type LinkRow = { projectId: string; userId: string };
type Who = { siteId: string; userId: string; organizationId: string };
type Publish = "published" | "unchanged" | "unavailable" | "refused";

/** Strata said no to the change itself (not "try later"): the message is for the owner. */
export class StrataRefused extends Error {}

export type ExtrasDeps = {
  link(siteId: string): Promise<LinkRow | null>;
  session(userId: string): Promise<string | null>;
  pending(siteId: string): Promise<{ components: DesignComponent[]; tokens: TokenRequest | null }>;
  /** Creates or updates each component (matched by name and look) in the project. Throws StrataRefused when Strata won't take one. */
  pushComponents(token: string, projectId: string, rows: DesignComponent[]): Promise<{ created: string[]; updated: string[] }>;
  /** Reads the project's tokens and changes the requested ones. */
  pushTokens(token: string, projectId: string, req: TokenRequest): Promise<{ sent: string[]; skipped: string[] }>;
  publish(token: string, projectId: string): Promise<Publish>;
  /** Keeps what is waiting on the site's row (merged with what already waits) and marks the site "waiting to send". */
  queue(siteId: string, patch: { components?: DesignComponent[]; tokens?: TokenRequest }, error: string): Promise<void>;
  clear(siteId: string, which: Array<"components" | "tokens">): Promise<void>;
  /** Puts the change into Plexo's own copy and the hosted brand sheet right now, so the site shows it even while Strata is out of reach. */
  keepCopy(siteId: string, change: { components?: DesignComponent[]; tokens?: TokenRequest }): Promise<void>;
  refreshSite(siteId: string): Promise<void>;
};

const mergeRequests = (a: TokenRequest | null, b: TokenRequest): TokenRequest => ({
  colours: { ...(a?.colours ?? {}), ...(b.colours ?? {}) },
  fonts: { ...(a?.fonts ?? {}), ...(b.fonts ?? {}) },
  fontWeights: { ...(a?.fontWeights ?? {}), ...(b.fontWeights ?? {}) },
  ...(a?.radius !== undefined || b.radius !== undefined ? { radius: b.radius ?? a?.radius } : {}),
  spacing: { ...(a?.spacing ?? {}), ...(b.spacing ?? {}) },
});

async function tokenFor(deps: ExtrasDeps, link: LinkRow, userId: string): Promise<string | null> {
  return (await deps.session(userId)) ?? (link.userId && link.userId !== userId ? await deps.session(link.userId) : null);
}

/** Creates or updates components in the site's Strata project, publishes, and refreshes Plexo's copy. Never throws. */
export async function sendComponentsToStrata(input: Who & { components: DesignComponent[] }, deps: ExtrasDeps = realExtrasDeps): Promise<ComponentSendResult> {
  const names = input.components.map((c) => String(c.name));
  const waiting = (): ComponentSendResult => ({ state: "waiting", message: WAITING_EXTRAS_NOTE, created: [], updated: [] });
  try {
    const link = await deps.link(input.siteId);
    if (!link) return { state: "not-set-up", message: NOT_IN_STRATA_NOTE, created: [], updated: [] };
    const waitingNow = await deps.pending(input.siteId);
    const rows = mergeComponentRows(waitingNow.components, input.components);
    const token = await tokenFor(deps, link, input.userId);
    if (!token) {
      await deps.keepCopy(input.siteId, { components: input.components }).catch(() => undefined);
      await deps.queue(input.siteId, { components: input.components }, "No Strata session");
      return waiting();
    }
    let result: { created: string[]; updated: string[] };
    try {
      result = await deps.pushComponents(token, link.projectId, rows);
    } catch (err) {
      if (err instanceof StrataRefused) return { state: "refused", message: err.message, created: [], updated: [] };
      throw err;
    }
    const published = await deps.publish(token, link.projectId);
    if (published === "unavailable" || published === "refused") {
      await deps.keepCopy(input.siteId, { components: input.components }).catch(() => undefined);
      await deps.queue(input.siteId, { components: input.components }, "Strata did not publish");
      return waiting();
    }
    await deps.clear(input.siteId, ["components"]);
    await deps.refreshSite(input.siteId);
    return { state: "in-strata", message: `${COMPONENT_SENT_NOTE}`, created: result.created, updated: result.updated };
  } catch (err) {
    console.warn(`[brand-send] ${input.siteId}: couldn't send ${names.join(", ")} to Strata`, err instanceof Error ? err.message : err);
    await deps.keepCopy(input.siteId, { components: input.components }).catch(() => undefined);
    await deps.queue(input.siteId, { components: input.components }, err instanceof Error ? err.message.slice(0, 200) : "failed").catch(() => undefined);
    return waiting();
  }
}

/** Changes colours, fonts, corners or spacing in the site's Strata project, publishes, and refreshes Plexo's copy. Never throws. */
export async function sendTokensToStrata(input: Who & { request: TokenRequest }, deps: ExtrasDeps = realExtrasDeps): Promise<TokenSendResult> {
  const waiting = (): TokenSendResult => ({ state: "waiting", message: WAITING_EXTRAS_NOTE, changed: [], skipped: [] });
  try {
    const link = await deps.link(input.siteId);
    if (!link) return { state: "not-set-up", message: NOT_IN_STRATA_NOTE, changed: [], skipped: [] };
    const waitingNow = await deps.pending(input.siteId);
    const request = mergeRequests(waitingNow.tokens, input.request);
    const token = await tokenFor(deps, link, input.userId);
    if (!token) {
      await deps.keepCopy(input.siteId, { tokens: input.request }).catch(() => undefined);
      await deps.queue(input.siteId, { tokens: input.request }, "No Strata session");
      return waiting();
    }
    let pushed: { sent: string[]; skipped: string[] };
    try {
      pushed = await deps.pushTokens(token, link.projectId, request);
    } catch (err) {
      if (err instanceof StrataRefused) return { state: "refused", message: err.message, changed: [], skipped: [] };
      throw err;
    }
    if (pushed.sent.length) {
      const published = await deps.publish(token, link.projectId);
      if (published === "unavailable" || published === "refused") {
        await deps.keepCopy(input.siteId, { tokens: input.request }).catch(() => undefined);
        await deps.queue(input.siteId, { tokens: input.request }, "Strata did not publish");
        return waiting();
      }
    }
    await deps.clear(input.siteId, ["tokens"]);
    if (pushed.sent.length) await deps.refreshSite(input.siteId);
    return {
      state: "in-strata",
      message: pushed.sent.length ? `Your brand is saved (${pushed.sent.join(", ")}). Your website follows it.` : pushed.skipped.length ? pushed.skipped.join(" ") : "Your brand already has those values.",
      changed: pushed.sent,
      skipped: pushed.skipped,
    };
  } catch (err) {
    console.warn(`[brand-send] ${input.siteId}: couldn't send brand changes to Strata`, err instanceof Error ? err.message : err);
    await deps.keepCopy(input.siteId, { tokens: input.request }).catch(() => undefined);
    await deps.queue(input.siteId, { tokens: input.request }, err instanceof Error ? err.message.slice(0, 200) : "failed").catch(() => undefined);
    return waiting();
  }
}

/** Sends whatever components and token changes are waiting for one site (the sweep, the next save, the "Send to Strata" button). Never throws. */
export async function flushWaitingExtras(who: Who, deps: ExtrasDeps = realExtrasDeps): Promise<void> {
  const w = await deps.pending(who.siteId).catch(() => ({ components: [] as DesignComponent[], tokens: null as TokenRequest | null }));
  // The waiting items are re-sent with an empty addition: sendComponentsToStrata merges them in itself.
  if (w.components.length) await sendComponentsToStrata({ ...who, components: [] }, deps);
  if (w.tokens) await sendTokensToStrata({ ...who, request: {} }, deps);
}

// ---------------------------------------------------------------- the real thing

const parse = <T>(raw: unknown): T | null => {
  if (typeof raw !== "string" || !raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export const realExtrasDeps: ExtrasDeps = {
  link: async (siteId) => {
    const { data } = await SiteBrand.get({ siteId }).go();
    return data ? { projectId: data.strataProjectId, userId: data.userId } : null;
  },
  session: async (userId) => (await loadStrataToken(userId).catch(() => null)) ?? ((await connectStrataInBackground(userId)) ? await loadStrataToken(userId).catch(() => null) : null),
  pending: async (siteId) => {
    const { data } = await SiteBrand.get({ siteId }).go();
    const components = parse<DesignComponent[]>(data?.pendingComponents);
    return { components: Array.isArray(components) ? components : [], tokens: parse<TokenRequest>(data?.pendingTokens) };
  },
  pushComponents: async (token, projectId, rows) => {
    const { strataFetch, pid } = await import("./siteBrand");
    const list = await strataFetch(`/projects/${pid(projectId)}/components`, token);
    if (list.status === 401 || list.status === 403 || list.status === 404) throw new StrataRefused("Plexo can't change this brand. Reconnect your brand (or ask its owner for edit access) and try again.");
    if (!list.ok) throw new Error(`Strata answered ${list.status}`);
    const existing = ((await list.json().catch(() => ({}))) as { data?: Array<{ id?: string; name?: string; variant?: string }> }).data ?? [];
    const created: string[] = [];
    const updated: string[] = [];
    for (const row of rows) {
      const variant = row.variant || "default";
      const match = existing.find((e) => String(e.name).toLowerCase() === String(row.name).toLowerCase() && (e.variant || "default") === variant);
      const body = { name: row.name, variant, props: row.props ?? {}, nodes: row.nodes };
      const res = match?.id
        ? await strataFetch(`/projects/${pid(projectId)}/components/${encodeURIComponent(match.id)}`, token, { method: "PATCH", body })
        : await strataFetch(`/projects/${pid(projectId)}/components`, token, { method: "POST", body });
      if (res.status === 400 || res.status === 422) {
        const detail = ((await res.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message;
        throw new StrataRefused(`Your brand didn't accept the component "${row.name}"${detail ? `: ${detail}` : ""}.`);
      }
      if (res.status === 401 || res.status === 403) throw new StrataRefused("Plexo can't change this brand. Reconnect your brand (or ask its owner for edit access) and try again.");
      if (!res.ok) throw new Error(`Strata answered ${res.status}`);
      (match?.id ? updated : created).push(String(row.name));
    }
    return { created, updated };
  },
  pushTokens: async (token, projectId, req) => {
    const { strataApiUrl } = await import("@/lib/strata/apiUrl");
    const { createStrataClient, StrataError } = await import("@charisol/plexo-sdk/v2/strata");
    const base = strataApiUrl();
    if (!base) throw new Error("Saving your brand isn't available on this Plexo yet.");
    const client = createStrataClient({ baseUrl: base, getToken: () => token });
    const snapshot = await client.pull(projectId);
    const plan = planTokenChanges(snapshot.tokens, req);
    if (!plan.tokens.length) return { sent: [], skipped: plan.skipped };
    try {
      await client.push(projectId, { variables: plan.tokens, components: [] }, snapshot.revision);
    } catch (err) {
      if (err instanceof StrataError && (err.kind === "invalid" || err.kind === "conflict")) throw new StrataRefused(err.message);
      throw err;
    }
    return { sent: plan.sent, skipped: plan.skipped };
  },
  publish: async (token, projectId) => (await import("./siteBrand")).publishStrataProject(token, projectId),
  queue: async (siteId, patch, error) => {
    const { data } = await SiteBrand.get({ siteId }).go();
    const set: Record<string, unknown> = { pendingPush: true, pushError: error, pushTriedAt: new Date().toISOString() };
    if (patch.components) set.pendingComponents = JSON.stringify(mergeComponentRows(parse<DesignComponent[]>(data?.pendingComponents) ?? [], patch.components)).slice(0, 300_000);
    if (patch.tokens) set.pendingTokens = JSON.stringify(mergeRequests(parse<TokenRequest>(data?.pendingTokens), patch.tokens));
    await SiteBrand.patch({ siteId }).set(set as never).go();
  },
  clear: async (siteId, which) => {
    const fields = which.map((w) => (w === "components" ? "pendingComponents" : "pendingTokens")) as Array<"pendingComponents" | "pendingTokens">;
    await SiteBrand.patch({ siteId }).remove(fields).go().catch(() => undefined);
    const { data } = await SiteBrand.get({ siteId }).go().catch(() => ({ data: null }));
    const stillWaiting = !!(data?.pendingComponents || data?.pendingTokens) || data?.pendingBrand === true;
    if (!stillWaiting) await SiteBrand.patch({ siteId }).set({ pendingPush: false, pushError: "", pushTriedAt: new Date().toISOString() }).go().catch(() => undefined);
  },
  keepCopy: async (siteId, change) => {
    // Apps keep their design system in their own project files; the sweep and the retry cover them.
    const { Template } = await import("@/lib/db/contentEntities");
    const { data: site } = await Template.get({ id: siteId }).go({ attributes: ["sourceType"] });
    if (!site || site.sourceType === "REACT_PROJECT") return;
    const { brandStore } = await import("./store");
    const { writeBrandSheet, forgetServingMemo } = await import("./siteBrand");
    const ds = (await brandStore().getDesignSystem(siteId)) as DesignSystem | null;
    if (!ds) return;
    let next: DesignSystem = ds;
    if (change.components?.length) next = { ...next, components: mergeComponentRows(next.components ?? [], change.components) };
    if (change.tokens) {
      const plan = planTokenChanges(next.tokens, change.tokens);
      if (plan.tokens.length) {
        const byKey = new Map(plan.tokens.map((t) => [t.key, t]));
        next = { ...next, tokens: [...next.tokens.map((t) => byKey.get(t.key) ?? t), ...plan.tokens.filter((t) => !next.tokens.some((x) => x.key === t.key))] };
      }
    }
    await brandStore().putDesignSystem(siteId, next);
    await writeBrandSheet(siteId, next);
    forgetServingMemo(siteId);
  },
  refreshSite: async (siteId) => {
    const { runSiteBrandUpdate } = await import("./siteBrand");
    await runSiteBrandUpdate(siteId, { source: "owner", force: true });
  },
};
