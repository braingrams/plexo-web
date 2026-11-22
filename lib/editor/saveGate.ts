/**
 * Keeps the editor's own saving (its Autosave and Save button) safe: one save at a time, a pile of quick edits becomes at most one
 * waiting save, and nothing saves while the page is busy with something that saves (going live, SOL changing several pages).
 * Tested in tests/editorSaveGate.test.ts.
 */
export type SaveGate = {
  /** Saves now, or when the gate allows it. Calls that arrive meanwhile share one follow-up save. */
  save: () => Promise<void>;
  /** While paused nothing starts; `save` waits. */
  setPaused: (paused: boolean) => void;
  isPaused: () => boolean;
};

export function createSaveGate(run: () => Promise<unknown>): SaveGate {
  let paused = false;
  let running: Promise<void> | null = null;
  let queued: Promise<void> | null = null;
  let release: (() => void) | null = null;
  let released: Promise<void> | null = null;

  const waitForResume = (): Promise<void> => {
    if (!paused) return Promise.resolve();
    released ??= new Promise<void>((r) => { release = r; });
    return released;
  };

  const start = (): Promise<void> => {
    const self: { p?: Promise<void> } = {};
    const p: Promise<void> = (async () => {
      await waitForResume();
      try { await run(); } finally { if (running === self.p) running = null; }
    })();
    self.p = p;
    running = p;
    return p;
  };

  return {
    save() {
      if (!running && !paused) return start();
      if (queued) return queued;
      const after = running ?? Promise.resolve();
      const q: Promise<void> = after.catch(() => undefined).then(() => { queued = null; return start(); });
      queued = q;
      return q;
    },
    setPaused(next) {
      paused = next;
      if (!next && release) { const r = release; release = null; released = null; r(); }
    },
    isPaused: () => paused,
  };
}

/** What went wrong while saving, in words a site owner can act on. */
export function saveFailureMessage(status: number | null, serverError?: string): string {
  if (status === null) return "You seem to be offline. Your changes are still here and will save when you're back online.";
  if (status === 401) return "You've been signed out. Sign in again in another tab, then press Save: your changes are still here.";
  if (status === 403) return "You can look at this page but not change it, so nothing was saved.";
  if (status === 409) return "This page was changed somewhere else (another tab or teammate). Reload to see the latest before saving again.";
  if (status === 413) return "This page is too large to save. Remove some big images and try again.";
  return serverError || "Couldn't save this page. Your changes are still here, so try again.";
}
