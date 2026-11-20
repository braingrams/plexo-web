/**
 * The editor's save model, as plain functions: Autosave is on unless the owner turned it off (remembered for them on this
 * device, not per page), the main button is "Save" and asks what to do, and a quiet status says how things stand
 * ("Saved 2 min ago"). Tested in tests/editorSaveModel.test.ts.
 */

export const AUTOSAVE_KEY = "plexo.editor.autosave";

type Store = Pick<Storage, "getItem" | "setItem">;

/** On by default. An older per-page choice is still honoured until the owner picks again. */
export function readAutosave(store: Store | null | undefined, legacyPageId?: string): boolean {
  try {
    const own = store?.getItem(AUTOSAVE_KEY);
    if (own === "true" || own === "false") return own === "true";
    const old = legacyPageId ? store?.getItem(`autosave-${legacyPageId}`) : null;
    if (old === "true" || old === "false") return old === "true";
  } catch {
    /* private mode: the default */
  }
  return true;
}

export function writeAutosave(store: Store | null | undefined, on: boolean): void {
  try {
    store?.setItem(AUTOSAVE_KEY, String(on));
  } catch {
    /* fine: the choice just won't be remembered */
  }
}

/** "just now", "2 min ago", "3 hours ago", "yesterday". */
export function savedAgo(savedAt: number | null, now: number = Date.now()): string {
  if (savedAt === null) return "";
  const s = Math.max(0, Math.round((now - savedAt) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? "1 hour ago" : `${h} hours ago`;
  return h < 48 ? "yesterday" : `${Math.round(h / 24)} days ago`;
}

export type SaveStatusInput = { saving: boolean; error: string | null; dirty: boolean; autosave: boolean; savedAt: number | null; now?: number };
export type SaveStatus = { tone: "saving" | "error" | "unsaved" | "saved" | "idle"; text: string };

/** The one quiet line next to the Save button. */
export function saveStatus(i: SaveStatusInput): SaveStatus {
  if (i.saving) return { tone: "saving", text: "Saving…" };
  if (i.error) return { tone: "error", text: "Couldn't save. Try again" };
  if (i.dirty) return { tone: "unsaved", text: i.autosave ? "Saving soon…" : "Unsaved changes" };
  if (i.savedAt !== null) return { tone: "saved", text: `Saved ${savedAgo(i.savedAt, i.now)}` };
  return { tone: "idle", text: i.autosave ? "Autosave is on" : "Autosave is off" };
}
