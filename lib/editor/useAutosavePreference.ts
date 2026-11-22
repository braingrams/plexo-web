import { useMemo } from "react";
import { createAutosavePreference, saveAutosaveToAccount } from "./autosavePref";

/** The `autosavePreference` host prop for the editor, from the owner's saved choice (undefined = not chosen yet, so the browser's copy or the default of on). */
export function useAutosavePreference(serverValue?: boolean | null) {
  return useMemo(
    () => createAutosavePreference({ store: typeof window === "undefined" ? null : window.localStorage, serverValue, save: saveAutosaveToAccount }),
    [serverValue],
  );
}
