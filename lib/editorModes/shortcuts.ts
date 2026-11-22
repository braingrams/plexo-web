/** Keyboard shortcuts of the page editor, written for people, with the right key for their computer. Pure. */
export type Shortcut = { keys: string; does: string };

export const SHORTCUTS: Shortcut[] = [
  { keys: "Mod+S", does: "Save" },
  { keys: "Mod+Z", does: "Undo. It works across Design, Code and Text." },
  { keys: "Mod+Shift+Z", does: "Redo" },
  { keys: "Mod+Shift+F", does: "Tidy up the code (spreads it over neat lines; the page looks the same)" },
  { keys: "Mod+/", does: "Turn the line into a note for yourself (a comment), and back" },
  { keys: "Mod+F", does: "Find a word in the code" },
  { keys: "Ctrl+Space", does: "Show suggestions" },
  { keys: "Tab", does: "Indent" },
];

/** "Mod+Shift+Z" becomes "⌘ Shift Z" on a Mac and "Ctrl Shift Z" elsewhere. */
export function formatShortcut(keys: string, isMac: boolean): string {
  return keys
    .split("+")
    .map((k) => (k === "Mod" ? (isMac ? "⌘" : "Ctrl") : k))
    .join(" ");
}

export const looksLikeMac = (platform: string | undefined | null): boolean => /mac|iphone|ipad|ipod/i.test(platform ?? "");
