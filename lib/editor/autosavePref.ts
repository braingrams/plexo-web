import { readAutosave, writeAutosave } from "./saveModel";

type Store = Parameters<typeof readAutosave>[0];

/**
 * The owner's Autosave choice for the editor: kept on their account (so it follows them between devices) and mirrored in this
 * browser (so it answers instantly and still works offline). Shared by the classic and the new editor.
 */
export function createAutosavePreference(opts: { store: Store; serverValue?: boolean | null; save: (on: boolean) => Promise<unknown> }) {
  return {
    get: (): boolean => {
      if (typeof opts.serverValue === "boolean") {
        writeAutosave(opts.store, opts.serverValue);
        return opts.serverValue;
      }
      return readAutosave(opts.store);
    },
    set: async (on: boolean): Promise<void> => {
      writeAutosave(opts.store, on);
      try { await opts.save(on); } catch { /* kept in this browser; the account copy catches up next time */ }
    },
  };
}

export const saveAutosaveToAccount = (on: boolean) =>
  fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ editorAutosave: on }) });
