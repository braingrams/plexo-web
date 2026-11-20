/** First-use hint for Design | Code | Text. Plain words, no jargon. Pure so the wording is tested once. */
export const MODE_HINT_KEY = "plexo.editModes.hint.v1";

export type ModeHint = { title: string; points: { label: string; text: string }[]; footnote: string };

export function modeHint(onBlocks: boolean): ModeHint {
  return {
    title: onBlocks ? "You can change this page as code, too" : "Three ways to change this page",
    points: [
      { label: "Design", text: onBlocks ? "What you are using now: move and change blocks." : "Click anything on the page to change its words, picture or link." },
      { label: "Code", text: "Change the page itself, with a live preview beside it." },
      { label: "Text", text: "Change the words, pictures and colours from a simple list." },
    ],
    footnote: onBlocks
      ? "Pick Code or Text above and we'll explain first. Your page looks the same, and we keep a backup you can restore."
      : "They all change the same page, so you can switch any time. Undo works across all three.",
  };
}

export function hintWasSeen(storage: Pick<Storage, "getItem"> | null): boolean {
  try {
    return storage?.getItem(MODE_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberHint(storage: Pick<Storage, "setItem"> | null): void {
  try {
    storage?.setItem(MODE_HINT_KEY, "1");
  } catch {
    // Remembering is a convenience; the hint just closes for now.
  }
}
