/**
 * What the left column of the dashboard shows, decided by the route (pure).
 *  - "menu": the normal main menu (Home, My sites, ...).
 *  - "sol":  inside SOL the column is taken over by the conversations, with the Plexo logo kept at
 *            the top and a small Chats | Menu switch so the main menu is always one tap away.
 */
export type SidebarMode = "menu" | "sol";
export type SidebarView = "chats" | "menu";

export function sidebarModeForPath(pathname: string | null | undefined): SidebarMode {
  const p = (pathname ?? "").split(/[?#]/)[0];
  return /^\/(dashboard|v3-preview)\/sol(\/|$)/.test(p) ? "sol" : "menu";
}

/** What is actually drawn: outside SOL always the menu; inside SOL whichever the person chose (Chats by default). */
export function sidebarViewFor(mode: SidebarMode, choice: SidebarView | null | undefined): SidebarView {
  if (mode === "menu") return "menu";
  return choice === "menu" ? "menu" : "chats";
}

export function parseSidebarChoice(value: unknown): SidebarView | null {
  return value === "chats" || value === "menu" ? value : null;
}

/**
 * How the dashboard frame is drawn around a screen:
 *  - "editor": the visual page editor keeps the app's side menu, folded to icons so it feels like Plexo without
 *    crowding the canvas, with an obvious button to open it. No top bar (the editor has its own).
 *  - "none": an app's editor brings all of its own chrome.
 *  - "full": everything else.
 */
export type ShellFrame = "full" | "editor" | "none";

export function shellFrameFor(pathname: string | null | undefined): ShellFrame {
  const p = (pathname ?? "").split(/[?#]/)[0].replace(/\/+$/, "");
  const page = p.match(/^\/dashboard\/templates\/([^/]+)$/);
  if (page && page[1] !== "upload") return "editor";
  return /^\/dashboard\/apps\/[^/]+$/.test(p) ? "none" : "full";
}

/** The editor's menu starts folded; the choice to open it is remembered separately from the normal pages' choice. */
export const EDITOR_SIDEBAR_KEY = "plx-sidebar-folded-editor";
export const PAGES_SIDEBAR_KEY = "plx-sidebar-folded";
export function foldedFromStorage(frame: ShellFrame, stored: string | null): boolean | null {
  if (stored === "1") return true;
  if (stored === "0") return false;
  return frame === "editor" ? true : null;
}
