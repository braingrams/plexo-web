import { editorQueriesFor, firstUndescribedPicture, type PageForLinks } from "./editorLinks";
import { buildIssues, describeMetrics, fixableCount, headline, trendWords } from "./explain";
import { isPsiConfigured } from "./psi";
import type { HealthReport, HealthStatus, SpeedReport } from "./types";

import type { Issue } from "./types";

function assistantNote(report: HealthReport | null, issues: Issue[]): string | null {
  if (!report) return null;
  const top = issues.find((i) => i.severity !== "good" && i.autoFix && !i.autoFix.on) ?? issues.find((i) => i.severity !== "good");
  if (!top) return "Nothing needs fixing right now. Tell the owner their site is in great shape.";
  const gain = top.gain ? ` ${top.gain}.` : "";
  return top.autoFix && !top.autoFix.on
    ? `The biggest thing: ${top.title.toLowerCase()}.${gain} Say it simply and ask: "Want me to fix that for you?" If yes, call apply_site_health_fix with fix "${top.autoFix.id}".`
    : `The biggest thing: ${top.title.toLowerCase()}.${gain} Plexo cannot fix this one by itself. Walk the owner through these steps: ${top.steps.join(" ")}`;
}

/** Each pointed-at element gets the address that opens the editor on it. Where Google pointed at nothing, our own scan stands in for pictures with no description. */
export function withEditorLinks(issues: Issue[], page: PageForLinks | undefined): Issue[] {
  if (!page) return issues;
  return issues.map((i) => {
    const pointers = i.where?.length ? i.where : i.id === "alt_text" && !i.autoFix?.on ? [firstUndescribedPicture(page.html)].filter((p): p is NonNullable<typeof p> => !!p) : undefined;
    if (!pointers?.length) return i;
    return { ...i, where: pointers.map((p) => ({ ...p, ...editorQueriesFor(page, p) })) };
  });
}

const toScore = (v: unknown): number | null => {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (v && typeof v === "object" && "score" in v && typeof (v as { score?: unknown }).score === "number") return (v as { score: number }).score;
  return null;
};

const scores = (s: SpeedReport | null | undefined) =>
  s
    ? {
        speed: toScore(s.speed) ?? 0,
        search: toScore(s.seo) ?? 0,
        easyToUse: toScore(s.accessibility) ?? 0,
        safeAndTidy: toScore(s.bestPractices) ?? 0,
      }
    : null;

/** A health status plus everything written in plain words: used by the Site health tab and the MCP tools. */
export function presentHealth(status: HealthStatus, opts: { html?: string; page?: PageForLinks } = {}) {
  const report: HealthReport | null = status.last?.report ?? null;
  const issues = report ? withEditorLinks(buildIssues({ speed: report.speed, aeo: report.aeo, settings: status.settings, html: opts.html, facts: status.facts }), opts.page) : [];
  const head = report ? headline(report) : null;
  return {
    ...status,
    available: isPsiConfigured(),
    headline: head?.text ?? null,
    headlineTone: head?.tone ?? null,
    perfect: head?.perfect ?? false,
    /** Phone first: it is the stricter test and the one Google ranks on. */
    devices: report
      ? {
          phone: report.speed ? { scores: scores(report.speed), metrics: describeMetrics(report.speed) } : null,
          computer: report.desktop ? { scores: scores(report.desktop), metrics: describeMetrics(report.desktop) } : null,
        }
      : null,
    /** Kept for older callers: the phone's timings. */
    metrics: report?.speed ? describeMetrics(report.speed) : [],
    issues,
    fixableCount: fixableCount(issues),
    /** For an AI assistant to say out loud: the biggest problem, and the offer to fix it. */
    assistantNote: assistantNote(report, issues),
    trend: trendWords(status.history),
    /** Shown when real visitor numbers are missing, so nobody thinks something is broken. */
    newSiteNote: report?.speed && !report.speed.hasRealVisitorData ? "Google has not measured real visitors to your site yet, so these numbers come from a test we ran just now. That is normal for newer sites." : null,
  };
}
