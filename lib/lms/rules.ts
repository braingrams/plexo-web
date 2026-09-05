import type { EntityItem } from "electrodb";
import type { LmsPage as LmsPageEntity, LmsEnrollment as LmsEnrollmentEntity, LmsPageProgress as LmsPageProgressEntity } from "@/lib/db/contentEntities";

type LmsPage = EntityItem<typeof LmsPageEntity>;
type LmsEnrollment = EntityItem<typeof LmsEnrollmentEntity>;
type LmsPageProgress = EntityItem<typeof LmsPageProgressEntity>;

/** The subset of a progress row every consumer of the progress map actually needs —
 * evaluatePageUnlock only reads completedAt/adminApprovedAt, but callers (the drip-reminder
 * sweep, page-content routes) also check firstViewedAt/dripReminderSentAt against the same
 * map rather than re-querying. */
export type LmsPageProgressLookup = Pick<LmsPageProgress, "completedAt" | "adminApprovedAt" | "firstViewedAt" | "dripReminderSentAt">;

/**
 * A single per-page unlock condition. Deliberately a discriminated union stored as opaque
 * JSON on LmsPage.unlockRules (not a typed ElectroDB attribute) — adding QUIZ_PASS's real
 * authoring UI/evaluator later, or an "ANY" (OR) mode, is a pure code change with zero
 * migration, since the DB attribute's shape never has to change either way.
 */
export type LmsUnlockCondition =
  | { type: "PREREQUISITE_PAGES"; pageIds: string[] }
  | { type: "TIME_DRIP_RELATIVE"; daysAfterEnrollment: number }
  | { type: "TIME_DRIP_FIXED_DATE"; unlockAt: string }
  | { type: "MANUAL_APPROVAL" }
  // Reserved: no quiz authoring UI or evaluator branch exists yet. Listed here so the
  // condition-type dropdown's union is already future-proof; evaluatePageUnlock currently
  // treats it as never-satisfied if it ever appears on a row.
  | { type: "QUIZ_PASS"; quizId: string; minScorePercent: number };

export interface LmsPageUnlockRules {
  /** v1 is AND-only per the confirmed requirement; "ANY" is a reserved future mode. */
  mode: "ALL";
  conditions: LmsUnlockCondition[];
}

/** Every new page gets this — rendered as plain text ("Unlocks when previous page is
 * finished"), never as an editable form, unless the admin explicitly opts into the
 * condition builder. `previousPageId` is null for the first page, which is always unlocked. */
export function defaultUnlockRules(previousPageId: string | null): LmsPageUnlockRules {
  if (!previousPageId) return { mode: "ALL", conditions: [] };
  return { mode: "ALL", conditions: [{ type: "PREREQUISITE_PAGES", pageIds: [previousPageId] }] };
}

export interface UnlockEvaluationResult {
  unlocked: boolean;
  blockedBy: LmsUnlockCondition[];
}

function isConditionSatisfied(
  condition: LmsUnlockCondition,
  pageId: string,
  enrollment: { enrolledAt: NonNullable<LmsEnrollment["enrolledAt"]> },
  progressByPageId: Map<string, LmsPageProgressLookup>,
  now: Date,
): boolean {
  switch (condition.type) {
    case "PREREQUISITE_PAGES":
      return condition.pageIds.every((id) => Boolean(progressByPageId.get(id)?.completedAt));
    case "TIME_DRIP_RELATIVE": {
      const enrolledAt = new Date(enrollment.enrolledAt);
      const unlockAt = new Date(enrolledAt.getTime() + condition.daysAfterEnrollment * 24 * 60 * 60 * 1000);
      return now >= unlockAt;
    }
    case "TIME_DRIP_FIXED_DATE":
      return now >= new Date(condition.unlockAt);
    case "MANUAL_APPROVAL":
      return Boolean(progressByPageId.get(pageId)?.adminApprovedAt);
    case "QUIZ_PASS":
      // Reserved — no quiz authoring/scoring exists yet, so this condition can never be
      // satisfied. A page that uses it today would be permanently locked, which is
      // intentional until the real evaluator ships.
      return false;
  }
}

/**
 * Pure — no DB reads. Callers fetch every page (byOrder) and every one of this learner's
 * progress rows (a single primary-key query, see buildProgressMap) once per request, then
 * call this per page in memory.
 */
export function evaluatePageUnlock(
  page: Pick<LmsPage, "id" | "unlockRules">,
  enrollment: { enrolledAt: NonNullable<LmsEnrollment["enrolledAt"]> },
  progressByPageId: Map<string, LmsPageProgressLookup>,
  now: Date = new Date(),
): UnlockEvaluationResult {
  const rules = (page.unlockRules as LmsPageUnlockRules | undefined) ?? { mode: "ALL", conditions: [] };
  const blockedBy = rules.conditions.filter(
    (condition) => !isConditionSatisfied(condition, page.id, enrollment, progressByPageId, now),
  );
  return { unlocked: blockedBy.length === 0, blockedBy };
}

/** Builds the per-page-id progress lookup evaluatePageUnlock expects, from the flat list of
 * LmsPageProgress rows a single primary-key query returns (see LmsPageProgress's own
 * comment in contentEntities.ts). */
export function buildProgressMap(
  rows: (Pick<LmsPageProgress, "pageId"> & LmsPageProgressLookup)[],
): Map<string, LmsPageProgressLookup> {
  const map = new Map<string, LmsPageProgressLookup>();
  for (const row of rows) map.set(row.pageId, row);
  return map;
}
