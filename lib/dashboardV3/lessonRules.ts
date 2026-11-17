import { evaluatePageUnlock, buildProgressMap, defaultUnlockRules, type LmsPageUnlockRules } from "@/lib/lms/rules";

/** The lesson "lock" choices an owner sees, in their own words (lib/lms/rules.ts holds the real rules). */
export type LockChoice = "open" | "after_previous" | "days" | "approve" | "custom";

export type LessonLite = { id: string; title: string; kind: string; unlockRules?: LmsPageUnlockRules | null; visible?: boolean };

export const LOCK_OPTIONS: { value: Exclude<LockChoice, "custom">; label: string }[] = [
  { value: "after_previous", label: "After they finish the lesson before" },
  { value: "open", label: "Right away" },
  { value: "days", label: "A number of days after they sign up" },
  { value: "approve", label: "When I approve them" },
];

export function lockChoice(rules: LmsPageUnlockRules | null | undefined, index: number): { choice: LockChoice; days: number } {
  const conds = rules?.conditions ?? [];
  if (conds.length === 0) return { choice: "open", days: 7 };
  const types = new Set(conds.map((c) => c.type));
  const days = (conds.find((c) => c.type === "TIME_DRIP_RELATIVE") as { daysAfterEnrollment: number } | undefined)?.daysAfterEnrollment ?? 7;
  if (conds.length === 1 && types.has("PREREQUISITE_PAGES")) return { choice: index === 0 ? "open" : "after_previous", days };
  if (conds.length === 1 && types.has("TIME_DRIP_RELATIVE")) return { choice: "days", days };
  if (types.has("MANUAL_APPROVAL") && [...types].every((t) => t === "MANUAL_APPROVAL" || t === "PREREQUISITE_PAGES")) return { choice: "approve", days };
  return { choice: "custom", days };
}

export function rulesFromChoice(choice: Exclude<LockChoice, "custom">, previousId: string | null, days = 7): LmsPageUnlockRules {
  switch (choice) {
    case "open":
      return { mode: "ALL", conditions: [] };
    case "after_previous":
      return defaultUnlockRules(previousId);
    case "days":
      return { mode: "ALL", conditions: [{ type: "TIME_DRIP_RELATIVE", daysAfterEnrollment: Math.max(0, Math.round(days)) }] };
    case "approve":
      return { mode: "ALL", conditions: [...(previousId ? [{ type: "PREREQUISITE_PAGES" as const, pageIds: [previousId] }] : []), { type: "MANUAL_APPROVAL" }] };
  }
}

/** One plain sentence about when a lesson opens. */
export function describeLock(rules: LmsPageUnlockRules | null | undefined, index: number): string {
  const { choice, days } = lockChoice(rules, index);
  switch (choice) {
    case "open":
      return index === 0 ? "Opens as soon as they sign up" : "Open to everyone from the start";
    case "after_previous":
      return "Opens after they finish the lesson before";
    case "days":
      return days === 0 ? "Opens the day they sign up" : `Opens ${days} day${days === 1 ? "" : "s"} after they sign up`;
    case "approve":
      return "Opens when you approve them";
    case "custom":
      return "Has its own rules (see More options)";
  }
}

export type ProgressRow = { pageId: string; completedAt?: string | null; adminApprovedAt?: string | null; firstViewedAt?: string | null; dripReminderSentAt?: string | null };

const toMap = (progress: ProgressRow[]) =>
  buildProgressMap(progress.map((p) => ({ pageId: p.pageId, completedAt: p.completedAt ?? undefined, adminApprovedAt: p.adminApprovedAt ?? undefined, firstViewedAt: p.firstViewedAt ?? undefined, dripReminderSentAt: p.dripReminderSentAt ?? undefined })));

/** The first lesson that only needs the owner's OK: everything else about it is already met. */
export function waitingLesson(lessons: LessonLite[], enrolledAt: string, progress: ProgressRow[], now: Date = new Date()): LessonLite | null {
  const map = toMap(progress);
  for (const l of lessons) {
    if (map.get(l.id)?.completedAt) continue;
    const ev = evaluatePageUnlock({ id: l.id, unlockRules: (l.unlockRules ?? { mode: "ALL", conditions: [] }) as never }, { enrolledAt }, map, now);
    if (ev.unlocked) return null; // they can already do this one; later ones aren't waiting on us yet
    if (ev.blockedBy.length > 0 && ev.blockedBy.every((c) => c.type === "MANUAL_APPROVAL")) return l;
  }
  return null;
}

export type LessonProgressState = "done" | "open" | "waiting" | "locked";

/** Lesson-by-lesson state for one learner (the drawer). */
export function lessonStates(lessons: LessonLite[], enrolledAt: string, progress: ProgressRow[], now: Date = new Date()): { lesson: LessonLite; state: LessonProgressState; doneAt: string | null }[] {
  const map = toMap(progress);
  return lessons.map((lesson) => {
    const done = map.get(lesson.id)?.completedAt ?? null;
    if (done) return { lesson, state: "done" as const, doneAt: done };
    const ev = evaluatePageUnlock({ id: lesson.id, unlockRules: (lesson.unlockRules ?? { mode: "ALL", conditions: [] }) as never }, { enrolledAt }, map, now);
    if (ev.unlocked) return { lesson, state: "open" as const, doneAt: null };
    return { lesson, state: ev.blockedBy.every((c) => c.type === "MANUAL_APPROVAL") ? ("waiting" as const) : ("locked" as const), doneAt: null };
  });
}

/**
 * "After the lesson before" stores that lesson's id, so moving or deleting lessons leaves it
 * pointing at the wrong one. Given the lessons in their new order, the rule updates needed so
 * each still means what it says.
 */
export function reconcileRules(ordered: LessonLite[]): { id: string; unlockRules: LmsPageUnlockRules }[] {
  const out: { id: string; unlockRules: LmsPageUnlockRules }[] = [];
  ordered.forEach((l, i) => {
    const current = l.unlockRules ?? { mode: "ALL" as const, conditions: [] };
    const { choice, days } = lockChoice(current, i);
    const previous = i === 0 ? null : ordered[i - 1].id;
    let want: LmsPageUnlockRules | null = null;
    if (choice === "after_previous" || choice === "approve") want = rulesFromChoice(choice, previous, days);
    else if (choice === "open" && i === 0 && current.conditions.length > 0) want = rulesFromChoice("open", null);
    if (want && JSON.stringify(want) !== JSON.stringify(current)) out.push({ id: l.id, unlockRules: want });
  });
  return out;
}
