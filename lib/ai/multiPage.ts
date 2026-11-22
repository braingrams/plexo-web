import { catalogSchema, createDefaultDesignSystem, describeDesign } from "@charisol/plexo-sdk/v2/compile";

import { Template } from "@/lib/db/contentEntities";
import { estimateWorstCaseCost, ensureCreditPeriod } from "@/lib/db/ledgerOperations";
import { MAX_PAGES_PER_RUN } from "@/lib/ai/multiPageRun";
import { solRouteForUser, tierFor } from "@/lib/ai/solEngine";
import { PAGE_ASSIST_NOTES } from "@/lib/ai/pageAssist";
import { currentDesign, formatLabel, loadOwnedRow, PageToolError, saveEdit, validateAndCompile } from "@/lib/mcp/v2Pages";
import { findRootTemplateId } from "@/lib/siteLayoutCore";
import { externalizeDesignSystem } from "@/lib/v2/designSystemStore";
import { syncPageEntries } from "@/lib/customSections/placements";
import type { V2Design } from "@/lib/v2/design";
import type { resolveUser } from "@/lib/auth/resolveUser";

// SOL on several pages at once. The AI part is the SAME as asking SOL in the editor (the streaming assist route does the
// asking, billing and refusing); the pieces here only read a page the way the editor would, save the answer as the page's
// working copy (never live), and take it back. Each page is its own small step, so a long site never has to fit in one request.

type ResolvedUser = NonNullable<Awaited<ReturnType<typeof resolveUser>>>;

export type PageForSol = { pageId: string; name: string; design: unknown; catalog: unknown };
export type PageSkip = { pageId: string; name: string; skipped: string };

/** Reads a page the way the editor does for SOL. Pages SOL can't change come back with a plain reason instead. */
export async function pageForSol(resolved: ResolvedUser, templateId: string): Promise<PageForSol | PageSkip> {
  const row = await loadOwnedRow(resolved, templateId);
  const kind = formatLabel(row);
  if (kind === "raw-html") return { pageId: row.id, name: row.name, skipped: "This page is hand-written code, so SOL can't change it here. Open it in the Code view to change it." };
  if (kind === "classic") return { pageId: row.id, name: row.name, skipped: "This page uses the older editor, so SOL can't change several pages at once on it. Open it and switch to the new editor first." };
  const design = await currentDesign(row);
  const summary = describeDesign(design.pages, design.designSystem ?? createDefaultDesignSystem());
  return { pageId: row.id, name: row.name, design: summary, catalog: catalogSchema() };
}

export type AppliedPage = { pageId: string; saved: boolean; changes: { change: string; ok: boolean; message: string }[]; message: string; before: V2Design | null };

/** Applies SOL's commands to the page's working copy (not live). `before` is what to hand back to undo it. */
export async function applyToPage(resolved: ResolvedUser, templateId: string, commands: unknown[]): Promise<AppliedPage> {
  const row = await loadOwnedRow(resolved, templateId);
  const before = row.draftJson ?? row.designJson ? await currentDesign(row) : null;
  const rootId = await findRootTemplateId(row.id, row.parentId ?? null);
  const out = (await saveEdit(row, commands, { live: false, who: { siteId: rootId, userId: resolved.userId, organizationId: resolved.organizationId } })) as {
    saved?: boolean;
    results?: { change: string; ok: boolean; message: string }[];
    notes?: string[];
    next?: string;
  };
  const changes = (out.results ?? []).map((r) => ({ change: r.change, ok: r.ok, message: r.message }));
  return { pageId: row.id, saved: out.saved === true, changes, message: out.saved ? "Changed." : (out.notes?.[0] ?? "Nothing was changed on this page."), before: out.saved ? before : null };
}

/** Puts a page back how it was before SOL changed it. */
export async function undoPage(resolved: ResolvedUser, templateId: string, before: unknown): Promise<void> {
  const row = await loadOwnedRow(resolved, templateId);
  if (before === null) {
    await Template.patch({ id: row.id }).remove(["draftJson", "draftHtml"]).go();
  } else {
    const checked = await validateAndCompile(row, before as V2Design);
    const toStore = await externalizeDesignSystem(checked.design);
    await Template.patch({ id: row.id }).set({ draftJson: toStore, draftHtml: checked.html }).go();
  }
  await syncPageEntries(row.id);
}

/** About what asking SOL on these pages could cost at most, in credits, and whether the balance covers it. */
export async function estimateRun(resolved: ResolvedUser, templateIds: string[]) {
  const route = await solRouteForUser(resolved.userId);
  if ("error" in route) return { error: route.error, status: route.status };
  const tier = tierFor(route.route, route.plan, "MEDIUM");
  const perPage: number[] = [];
  for (const id of templateIds.slice(0, MAX_PAGES_PER_RUN)) {
    const page = await pageForSol(resolved, id).catch(() => null);
    const chars = page && "design" in page ? JSON.stringify(page.design).length + JSON.stringify(page.catalog).length + PAGE_ASSIST_NOTES.length + 6_000 : 0;
    perPage.push(page && "design" in page ? estimateWorstCaseCost(route.route.provider, tier, "page_assist", chars) : 0);
  }
  const paidBy = route.route.paidBy;
  const total = paidBy === "plexo" ? perPage.reduce((a, b) => a + b, 0) : 0;
  const balance = paidBy === "plexo" ? (await ensureCreditPeriod(resolved.userId)).available : null;
  return { paidBy, perPage, total, balance, enough: balance === null ? true : balance >= (perPage[0] ?? 0) };
}

export { PageToolError };
