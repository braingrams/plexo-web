// Runs the quality gate (lib/ai/solQuality.ts) after SOL builds or edits a page and folds the verdict into the tool's own
// result, so the model reads it in the same breath as "saved". The state lives for one turn; lib/ai/solAgent.ts uses
// `openFailures` to stop SOL from saying "done" while a must-fix item is open (bounded by MAX_GATE_ROUNDS).

import type { Brief } from "./solBrief";
import { checkPage, formatGateFeedback, type GateReport } from "./solQuality";

export const MAX_GATE_ROUNDS = 3;
/** Tools that leave a visual page in a new state worth checking. */
export const GATE_TOOLS = new Set(["site_create", "page_create_from_template", "page_edit", "create_site_from_template"]);
const MAX_PAGES_CHECKED = 4;

export type GateState = { rounds: number; open: Map<string, { name: string; report: GateReport }> };
export const newGateState = (): GateState => ({ rounds: 0, open: new Map() });

/** The page ids a tool result touched, home first. */
export function touchedPageIds(result: unknown): string[] {
  if (!result || typeof result !== "object") return [];
  const r = result as { templateId?: unknown; siteId?: unknown; pages?: Array<{ templateId?: unknown }>; saved?: unknown; ok?: unknown; success?: unknown };
  if (r.saved === false || r.ok === false || r.success === false) return [];
  const ids = [r.siteId, r.templateId, ...(Array.isArray(r.pages) ? r.pages.map((p) => p?.templateId) : [])].filter((x): x is string => typeof x === "string" && x.length > 0);
  return [...new Set(ids)].slice(0, MAX_PAGES_CHECKED);
}

/** What the gate needs from storage, injected so the loop can be tested without a database. */
export type PageLoader = (templateId: string) => Promise<{ name: string; html: string; kind: "page" | "layout"; knownRoutes?: string[] } | null>;

/** Checks the pages a tool call touched. Returns the result with a `qualityCheck` note added (or untouched when nothing applies). */
export async function applyQualityGate(toolName: string, toolResult: unknown, brief: Brief | undefined, state: GateState, load: PageLoader): Promise<unknown> {
  if (!GATE_TOOLS.has(toolName) || !toolResult || typeof toolResult !== "object") return toolResult;
  try {
    const ids = touchedPageIds(toolResult);
    if (!ids.length) return toolResult;
    const notes: string[] = [];
    let anyFail = false;
    const worst: GateReport[] = [];
    const next = state.rounds + 1;
    for (const id of ids) {
      const page = await load(id);
      if (!page) continue;
      const report = checkPage({ html: page.html, brief, knownRoutes: page.knownRoutes, kind: page.kind });
      worst.push(report);
      if (report.passed) state.open.delete(id);
      else {
        state.open.set(id, { name: page.name, report });
        anyFail = true;
      }
      if (!report.passed || report.findings.length) notes.push(formatGateFeedback(report, { round: Math.min(next, MAX_GATE_ROUNDS), maxRounds: MAX_GATE_ROUNDS, pageName: page.name }));
      else notes.push(`Quality check for "${page.name}": PASSED (${report.score}/100).`);
    }
    if (!notes.length) return toolResult;
    if (anyFail) state.rounds = next;
    const last = anyFail && state.rounds >= MAX_GATE_ROUNDS;
    const tail = last
      ? "\nThis was the last automatic check this turn. If something is still open, tell the owner in one plain sentence what's left and offer to fix it next."
      : anyFail
        ? "\nFix the MUST items now, then the page is checked again."
        : "\nWhen you tell the owner it's ready: a short plain-words summary of what you built, then 2 or 3 meaningful next improvements. Don't mention scores or checks.";
    return { ...(toolResult as object), qualityCheck: notes.join("\n\n") + tail, qualityPassed: !anyFail, qualityScore: Math.min(...worst.map((w) => w.score)) };
  } catch (err) {
    console.error("quality gate failed (ignored)", err);
    return toolResult;
  }
}

/** The note that stops SOL from finishing while a must-fix item is open; null when it may finish. */
export function unfinishedNote(state: GateState): string | null {
  if (state.open.size === 0 || state.rounds >= MAX_GATE_ROUNDS) return null;
  const lines = [...state.open.values()].flatMap(({ name, report }) => report.findings.filter((f) => f.severity === "must").slice(0, 6).map((f) => `- ${name}: ${f.message} Fix: ${f.fix}`));
  return `Not finished: the quality check still has must-fix items open. Don't tell the owner it's done yet. Fix them with page_edit now (the page is checked again after each edit):\n${lines.join("\n")}`;
}

/** The final message when the automatic checks ran out of rounds with must-fix items still open: plain words, no scores. */
export function leftoverMessage(state: GateState): string {
  const lines = [...state.open.values()].flatMap(({ name, report }) => report.findings.filter((f) => f.severity === "must").slice(0, 3).map((f) => `- ${name}: ${f.message}`));
  const list = lines.slice(0, 5).join("\n");
  return `I've built it, but a few things still aren't right and I ran out of tries this time:\n${list}\n\nSay "fix those" and I'll carry on from here. Everything else is saved.`;
}

/** Real loader: the stored page (working copy first), its kind and the site's real paths. Lazy imports keep this file cheap to test. */
export function pageLoaderFor(resolved: { organizationId: string; userId: string }): PageLoader {
  return async (templateId) => {
    const [{ loadOwnedRow, loadSiteRows, formatLabel }, { pathForPage }, { findRootTemplateId }] = await Promise.all([import("@/lib/mcp/v2Pages"), import("@/server/slugDynamo"), import("@/lib/siteLayoutCore")]);
    const row = await loadOwnedRow(resolved as never, templateId);
    if (formatLabel(row) !== "v2") return null;
    const html = (row.draftHtml ?? row.compiledHtml) as string | undefined;
    if (!html) return null;
    let knownRoutes: string[] | undefined;
    try {
      const rootId = await findRootTemplateId(row.id, row.parentId ?? null);
      const rows = await loadSiteRows(resolved, rootId);
      knownRoutes = rows.filter((r) => !r.isSiteLayoutFragment && !r.isBlogLayout && !r.isCommerceLayout).map((r) => pathForPage(r.id, rows));
    } catch {
      knownRoutes = undefined; // can't list the site's pages: skip the page-link check rather than guess
    }
    return { name: row.name, html, kind: row.isSiteLayoutFragment ? "layout" : "page", knownRoutes };
  };
}
