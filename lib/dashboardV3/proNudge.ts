/**
 * The small "ready for more control?" card on a simple (guided) dashboard. The full view is otherwise only reachable from the
 * profile menu, which nobody finds, so the dashboard offers it now and then. Pure logic; the card stores `{ visits, dismissedAt }` in the browser.
 */
import type { Experience } from "./nav";

export const NUDGE_AFTER_VISITS = 3;
export const NUDGE_QUIET_DAYS = 14;
export const NUDGE_KEY = "plx-pro-nudge";

export type NudgeState = { visits: number; dismissedAt?: number; /** They have already switched to the full view from this card: it never comes back. */ tried?: boolean };

/** Shown to someone on the guided view who has used the dashboard a few times, and not in the last two weeks after they said "not now". */
export function shouldShowProNudge(input: { experience: Experience; state: NudgeState; now: number }): boolean {
  if (input.experience !== "beginner") return false;
  if (input.state.tried) return false;
  if (input.state.visits < NUDGE_AFTER_VISITS) return false;
  const d = input.state.dismissedAt;
  return d === undefined || input.now - d > NUDGE_QUIET_DAYS * 86_400_000;
}

export function readNudgeState(raw: string | null): NudgeState {
  try {
    const v = JSON.parse(raw ?? "null") as Partial<NudgeState> | null;
    return { visits: Number.isFinite(v?.visits) ? Math.max(0, Number(v!.visits)) : 0, ...(Number.isFinite(v?.dismissedAt) ? { dismissedAt: Number(v!.dismissedAt) } : {}), ...(v?.tried === true ? { tried: true } : {}) };
  } catch {
    return { visits: 0 };
  }
}
