import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@uiw/react-codemirror";
import type { CodeProblem } from "./htmlLint";

/** Underlines the problems htmlLint found, in the Code view. The marks follow the text as you type until the next check. */
export const setProblems = StateEffect.define<CodeProblem[]>();

function build(problems: CodeProblem[], length: number): DecorationSet {
  const marks = problems
    .filter((p) => p.from < length)
    .map((p) => Decoration.mark({ class: p.severity === "error" ? "plx-problem" : "plx-hint", attributes: { title: p.message } }).range(p.from, Math.min(p.to, length)))
    .sort((a, b) => a.from - b.from);
  return Decoration.set(marks, true);
}

export const problemMarks = [
  StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(deco, tr) {
      let next = deco.map(tr.changes);
      for (const e of tr.effects) if (e.is(setProblems)) next = build(e.value, tr.state.doc.length);
      return next;
    },
    provide: (f) => EditorView.decorations.from(f),
  }),
  EditorView.baseTheme({
    ".plx-problem": { textDecoration: "underline wavy #f87171", textUnderlineOffset: "3px" },
    ".plx-hint": { textDecoration: "underline dotted #fbbf24", textUnderlineOffset: "3px" },
  }),
];

/** Moves the cursor to a place in the page's code and shows it. */
export function jumpTo(view: EditorView, offset: number): void {
  const pos = Math.max(0, Math.min(offset, view.state.doc.length));
  view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
  view.focus();
}
