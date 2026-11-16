import { ROLLOUT_MODES, VERSION_STATUSES, type DashboardVersionRow } from "./types";

export const VERSION_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

/** Validates a registry row from the admin. Returns plain-words errors (empty = fine). */
export function validateVersionRow(row: Partial<DashboardVersionRow>, all: DashboardVersionRow[] = []): string[] {
  const errors: string[] = [];
  if (!row.id || !VERSION_ID_PATTERN.test(row.id)) errors.push("The id must be lowercase letters, numbers or dashes, starting with a letter (for example v4).");
  if (!row.label?.trim()) errors.push("Give the version a name people will see.");
  else if (row.label.length > 60) errors.push("The name is too long (60 characters at most).");
  if ((row.description ?? "").length > 300) errors.push("The description is too long (300 characters at most).");
  if (row.rolloutMode !== undefined && row.rolloutMode !== null && !(ROLLOUT_MODES as readonly string[]).includes(row.rolloutMode)) errors.push("Pick one of: off, selected people, offered, mandatory.");
  if (row.status !== undefined && row.status !== null && !(VERSION_STATUSES as readonly string[]).includes(row.status)) errors.push("Status must be beta, stable or retired.");
  if (row.whatsNew && (row.whatsNew.length > 3 || row.whatsNew.some((b) => typeof b !== "string" || b.length > 140))) errors.push("What's new takes up to 3 short bullets (140 characters each).");
  if (row.remindAfterDays !== undefined && row.remindAfterDays !== null && (!Number.isInteger(row.remindAfterDays) || row.remindAfterDays < 1 || row.remindAfterDays > 365)) errors.push("Ask again after must be between 1 and 365 days.");
  if (row.isDefault && (row.rolloutMode ?? "OFF") !== "OFF") errors.push("The default dashboard isn't rolled out. Everyone without another version sees it.");
  if (row.rolloutMode === "MANDATORY" && row.status === "retired") errors.push("A retired version can't be mandatory.");
  const otherDefaults = all.filter((r) => r.isDefault && r.id !== row.id);
  if (row.isDefault && otherDefaults.length > 0) errors.push(`${otherDefaults[0].label} is already the default. Change that one first.`);
  return errors;
}
