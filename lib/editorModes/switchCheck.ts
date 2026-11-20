/**
 * Before the editor changes view (Design / Code / Text) for the same page, work out in plain words whether the
 * switch needs a heads-up. Pure so it is tested once (tests/editorModes.test.ts).
 *
 * Nothing is ever dropped from the page: the three views edit the same HTML. What can happen is that the view you move
 * to can't change some part (content built by the page's own scripts, frames, drawings), or that unsaved work has to
 * be saved first so the other view sees it.
 */
import { lintHtml } from "./htmlLint";

export type EditorViewName = "design" | "code" | "text";

export const VIEW_LABELS: Record<EditorViewName, string> = { design: "Design", code: "Code", text: "Text" };

export type SwitchNotice = { kind: "save" | "limit" | "broken"; text: string };

const VIEW_PHRASE: Record<"design" | "text", string> = { design: "Design view", text: "Text view" };

export function checkSwitch(input: { html: string; from: EditorViewName; to: EditorViewName; unsaved: boolean }): SwitchNotice[] {
  const { html, from, to, unsaved } = input;
  if (from === to) return [];
  const notes: SwitchNotice[] = [];
  if (unsaved) {
    notes.push({ kind: "save", text: "You have changes that aren't saved yet. We'll save them first, so they come with you." });
  }
  if (to === "text" || to === "design") {
    const view = VIEW_PHRASE[to];
    // Broken code is the likeliest reason an edit lands somewhere unexpected, so say so before leaving the Code view.
    if (from === "code") {
      const errors = lintHtml(html).filter((p) => p.severity === "error").length;
      if (errors > 0) {
        notes.push({
          kind: "broken",
          text: `Your code has ${errors === 1 ? "1 thing" : `${errors} things`} to fix (see the list above the code). Until it is fixed, the page can look different from what you meant, and changes made in ${view} may end up in the wrong place.`,
        });
      }
    }
    const body = html.replace(/<!--[\s\S]*?-->/g, "");
    if (/<script\b[^>]*>[\s\S]*?(document\.write|innerHTML|insertAdjacentHTML|\.append\(|\.appendChild\()[\s\S]*?<\/script>/i.test(body)) {
      notes.push({ kind: "limit", text: `Part of this page is built by its own scripts. It will keep working, but you won't be able to change those words in ${view}. Use Code view for them.` });
    }
    if (/<iframe\b/i.test(body)) {
      notes.push({ kind: "limit", text: "This page has an embedded frame (like a video or map). Its content can't be changed here, only the page around it." });
    }
    if (/<svg\b[\s\S]*?<text\b/i.test(body)) {
      notes.push({ kind: "limit", text: `Words inside drawings or logos (SVG) can't be changed in ${view}. Use Code view for them.` });
    }
  }
  return notes;
}

/** True when the notes are worth stopping for (not just "we'll save first"). */
export const needsConfirmation = (notes: SwitchNotice[]): boolean => notes.some((n) => n.kind !== "save");
