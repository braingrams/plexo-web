/**
 * Learners page maths (pure): progress, the plain-word state of each person, filters, the four
 * summary numbers and the CSV. The server sends rows already holding what the lists need.
 */
export type LearnerRow = {
  email: string;
  name: string | null;
  status: "ACTIVE" | "REVOKED";
  paymentStatus: "FREE" | "PAID" | "REFUNDED";
  enrolledAt: string;
  lastActiveAt: string | null;
  completedPageCount: number;
  completedAt: string | null;
  /** The lesson this person can't open until the owner approves them, if any. */
  waitingLessonId: string | null;
};

export type LearnerFilter = "all" | "active" | "finished" | "waiting" | "paid" | "free" | "removed";

export const LEARNER_FILTERS: { id: LearnerFilter; label: string }[] = [
  { id: "all", label: "Everyone" },
  { id: "active", label: "Active" },
  { id: "finished", label: "Finished" },
  { id: "waiting", label: "Waiting for approval" },
  { id: "paid", label: "Paid" },
  { id: "free", label: "Free" },
];

const DAY = 24 * 60 * 60 * 1000;

/** 0 to 100, never beyond (a lesson removed after someone finished it can't push it past 100). */
export function progressPercent(done: number, total: number): number {
  if (total <= 0 || done <= 0) return 0;
  return Math.min(100, Math.round((done / total) * 100));
}

export function isFinished(row: Pick<LearnerRow, "completedAt" | "completedPageCount">, total: number): boolean {
  return !!row.completedAt || (total > 0 && row.completedPageCount >= total);
}

export type LearnerState = "removed" | "waiting" | "finished" | "active";

export function learnerState(row: LearnerRow, total: number): LearnerState {
  if (row.status === "REVOKED") return "removed";
  if (row.waitingLessonId) return "waiting";
  if (isFinished(row, total)) return "finished";
  return "active";
}

export function displayName(row: Pick<LearnerRow, "name" | "email">): string {
  return row.name?.trim() || row.email.split("@")[0] || row.email;
}

export function matchesFilter(row: LearnerRow, filter: LearnerFilter, total: number): boolean {
  const state = learnerState(row, total);
  switch (filter) {
    case "all":
      return state !== "removed";
    case "removed":
      return state === "removed";
    case "active":
      return state === "active" || state === "waiting";
    case "finished":
      return state === "finished";
    case "waiting":
      return state === "waiting";
    case "paid":
      return state !== "removed" && row.paymentStatus === "PAID";
    case "free":
      return state !== "removed" && row.paymentStatus !== "PAID";
  }
}

export function filterLearners(rows: LearnerRow[], opts: { query?: string; filter?: LearnerFilter; total: number }): LearnerRow[] {
  const q = (opts.query ?? "").trim().toLowerCase();
  return rows.filter((r) => matchesFilter(r, opts.filter ?? "all", opts.total) && (!q || r.email.toLowerCase().includes(q) || (r.name ?? "").toLowerCase().includes(q)));
}

export type LearnerSummary = { learners: number; activeThisWeek: number; finished: number; sales: number };

export function summarize(rows: LearnerRow[], total: number, now: Date = new Date()): LearnerSummary {
  const live = rows.filter((r) => r.status !== "REVOKED");
  const since = now.getTime() - 7 * DAY;
  return {
    learners: live.length,
    activeThisWeek: live.filter((r) => r.lastActiveAt && new Date(r.lastActiveAt).getTime() >= since).length,
    finished: live.filter((r) => isFinished(r, total)).length,
    sales: live.filter((r) => r.paymentStatus === "PAID").length,
  };
}

/** "Today", "Yesterday", "3 days ago", "2 weeks ago", or "Not yet". */
export function lastActiveLabel(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "Not yet";
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / DAY);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

const csvCell = (v: string): string => {
  // A cell that starts like a formula would run in a spreadsheet; the apostrophe keeps it text.
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

const STATE_LABEL: Record<LearnerState, string> = { removed: "Removed", waiting: "Waiting for approval", finished: "Finished", active: "Active" };

export function learnersCsv(rows: LearnerRow[], total: number): string {
  const head = ["Name", "Email", "Lessons finished", "Total lessons", "Progress %", "Status", "Paid or free", "Signed up", "Last active"];
  const lines = rows.map((r) =>
    [
      r.name ?? "",
      r.email,
      String(r.completedPageCount),
      String(total),
      String(progressPercent(r.completedPageCount, total)),
      STATE_LABEL[learnerState(r, total)],
      r.paymentStatus === "PAID" ? "Paid" : r.paymentStatus === "REFUNDED" ? "Refunded" : "Free",
      r.enrolledAt.slice(0, 10),
      r.lastActiveAt ? r.lastActiveAt.slice(0, 10) : "",
    ].map(csvCell).join(","),
  );
  return [head.join(","), ...lines].join("\n");
}
