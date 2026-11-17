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
