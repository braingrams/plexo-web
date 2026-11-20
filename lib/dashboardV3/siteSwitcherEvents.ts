/**
 * The site switcher (shell) and the things that want to open it (Home's "All my websites", the tour) live far
 * apart in the tree, so they talk through two window events instead of threading props through the shell.
 */
export const OPEN_SITE_SWITCHER_EVENT = "plx:open-site-switcher";
/** Fired by the tour on every step change ({ id: the step's id, or null when the tour stops }). */
export const TOUR_STEP_EVENT = "plx:tour-step";
/** The tour step that points at the open switcher panel. */
export const SWITCHER_PANEL_STEP = "sites-switch-panel";

/** Open the shell's site switcher. Returns false when this screen has none (non-beginner views), so the caller can go to the sites list instead. */
export function openSiteSwitcher(doc: Document = document): boolean {
  const has = Array.from(doc.querySelectorAll<HTMLElement>('[data-tour="site-switcher"] button')).some((b) => b.getClientRects().length > 0 || doc.defaultView === null);
  if (!has) return false;
  doc.defaultView?.dispatchEvent(new CustomEvent(OPEN_SITE_SWITCHER_EVENT));
  return true;
}
