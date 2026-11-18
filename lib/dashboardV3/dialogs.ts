/**
 * Two pop-ups at once look like a glitch. The tour offer opens by itself, so it waits for any other open dialog and
 * comes back when that one closes. `ownMarker` is a class inside the dialog that must not count (the offer itself).
 */
export function otherDialogOpen(root: ParentNode, ownMarker: string): boolean {
  return Array.from(root.querySelectorAll('[role="dialog"][aria-modal="true"]')).some((d) => !d.querySelector(`.${ownMarker}`));
}
