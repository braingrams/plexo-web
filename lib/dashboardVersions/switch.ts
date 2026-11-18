import { MAX_HISTORY, type SwitchActor, type SwitchHistoryEntry, type VersionUser } from "./types";

export type SwitchInput = { to: string; by: SwitchActor; adminId?: string; note?: string; locked?: boolean };

/** The user fields to write for a switch. Appends to the (capped) history; the last entry is the truth. */
export function buildSwitchPatch(user: VersionUser, input: SwitchInput, now: Date = new Date(), currentId: string | null = null) {
  const from = currentId ?? user?.dashboardVersion ?? null;
  const entry: SwitchHistoryEntry = { at: now.toISOString(), from, to: input.to, by: input.by };
  if (input.adminId) entry.adminId = input.adminId;
  if (input.note?.trim()) entry.note = input.note.trim().slice(0, 300);
  const history = [...(user?.dashboardVersionHistory ?? []), entry].slice(-MAX_HISTORY);
  return { dashboardVersion: input.to, dashboardVersionLocked: input.locked === true, dashboardVersionHistory: history };
}
