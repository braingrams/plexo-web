/**
 * One undo history for the whole page, shared by Design, Code and Text, so "undo" still works after you switch view
 * (a change made by clicking in Design can be undone from Code, and the other way round). It keeps whole-page snapshots;
 * pages are small enough that this is simpler and safer than replaying edits. Pure, tested in tests/editorHistory.test.ts.
 */
export type History = {
  /** Oldest first; `index` is the one on screen. */
  entries: string[];
  index: number;
  /** When the current entry was last written (ms), for joining a burst of typing into one step. */
  at: number;
};

export const HISTORY_LIMIT = 100;
/** Typing within this long of the last keystroke is one undo step, not one per letter. */
export const JOIN_WITHIN_MS = 900;

export const createHistory = (initial: string, now = 0): History => ({ entries: [initial], index: 0, at: now });

export const current = (h: History): string => h.entries[h.index];
export const canUndo = (h: History): boolean => h.index > 0;
export const canRedo = (h: History): boolean => h.index < h.entries.length - 1;

/**
 * Records a new version of the page. `join` lets a burst of typing become one step. Anything that was "redo" is dropped
 * (as in every editor). Writing the same page again does nothing.
 */
export function record(h: History, value: string, opts: { now: number; join?: boolean }): History {
  if (value === current(h)) return h;
  const keep = h.entries.slice(0, h.index + 1);
  const join = !!opts.join && h.index > 0 && h.index === h.entries.length - 1 && opts.now - h.at <= JOIN_WITHIN_MS;
  const entries = join ? [...keep.slice(0, -1), value] : [...keep, value];
  const cut = Math.max(0, entries.length - HISTORY_LIMIT);
  return { entries: cut ? entries.slice(cut) : entries, index: entries.length - 1 - cut, at: opts.now };
}

export function undo(h: History): History {
  return canUndo(h) ? { ...h, index: h.index - 1, at: 0 } : h;
}

export function redo(h: History): History {
  return canRedo(h) ? { ...h, index: h.index + 1, at: 0 } : h;
}

/** A save or a reload moved the "starting point": anything older can still be undone, nothing is lost. */
export function rebase(h: History, value: string, now: number): History {
  return record(h, value, { now, join: false });
}
