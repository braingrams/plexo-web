/** When the Save changes / Discard bar shows and whether Save works. Pure. */
export type SaveBarState = { visible: boolean; canSave: boolean; canDiscard: boolean };

export function saveBarState(o: { dirty: boolean; saving?: boolean; valid?: boolean }): SaveBarState {
  const saving = !!o.saving;
  return { visible: o.dirty || saving, canSave: o.dirty && !saving && o.valid !== false, canDiscard: o.dirty && !saving };
}

/** Shallow compare of a form's values against what was last saved. */
export function isDirty<T extends Record<string, unknown>>(saved: T, current: T): boolean {
  return (Object.keys(current) as (keyof T)[]).some((k) => (current[k] ?? "") !== (saved[k] ?? ""));
}
