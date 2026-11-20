/**
 * Plain-language hints for broken HTML, shown in the Code view while you type ("The <div> on line 12 is never closed").
 * Built on the structural problems htmlSource.ts finds. Errors are things that make a page look wrong; hints are
 * things worth fixing but harmless. Pure, so it is tested once (tests/htmlLint.test.ts).
 */
import { parseSource, type SrcDoc } from "./htmlSource";

export type CodeProblem = {
  from: number;
  to: number;
  line: number;
  col: number;
  severity: "error" | "hint";
  message: string;
};

const MAX_PROBLEMS = 50;

function lineStarts(html: string): number[] {
  const starts = [0];
  for (let i = 0; i < html.length; i++) if (html[i] === "\n") starts.push(i + 1);
  return starts;
}

function lineOf(starts: number[], pos: number): { line: number; col: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, col: pos - starts[lo] + 1 };
}

export function lintHtml(html: string, doc: SrcDoc = parseSource(html)): CodeProblem[] {
  const starts = lineStarts(html);
  const out: CodeProblem[] = [];
  const add = (from: number, to: number, severity: CodeProblem["severity"], message: (line: number) => string) => {
    const { line, col } = lineOf(starts, from);
    out.push({ from, to: Math.max(to, from + 1), line, col, severity, message: message(line) });
  };

  for (const i of doc.issues) {
    const tag = i.tag ? `<${i.tag}>` : "this tag";
    switch (i.kind) {
      case "unclosed":
        add(i.from, i.to, "error", (l) => `The ${tag} that starts on line ${l} is never closed. Add </${i.tag}> where it should end.`);
        break;
      case "mismatch":
        add(i.from, i.to, "error", (l) => `The ${tag} on line ${l} is still open when </${i.expected}> arrives. Close it first with </${i.tag}>.`);
        break;
      case "stray-close":
        add(i.from, i.to, "error", (l) => `There is a closing </${i.tag}> on line ${l}, but nothing was opened for it. Remove it, or add the opening <${i.tag}> before it.`);
        break;
      case "unclosed-tag":
        add(i.from, i.to, "error", (l) => `The ${tag} on line ${l} is missing its closing ">".`);
        break;
      case "unclosed-quote":
        add(i.from, i.to, "error", (l) => `A quote is never closed in the ${tag} on line ${l}. Add a matching " after the value of ${i.attr}.`);
        break;
      case "unclosed-comment":
        add(i.from, i.to, "error", (l) => `A comment that starts on line ${l} never ends. Add --> at the end of it.`);
        break;
      case "duplicate-attr":
        add(i.from, i.to, "hint", (l) => `The ${tag} on line ${l} has "${i.attr}" twice. Only the first one counts, so join them into one.`);
        break;
    }
  }

  // Worth fixing, harmless: pictures without a description, and an id used twice.
  const ids = new Map<string, number>();
  for (const el of doc.elements) {
    if (el.name === "img" && !el.attrs.some((a) => a.lname === "alt")) {
      add(el.start, el.tagEnd, "hint", (l) => `The picture on line ${l} has no description. Add alt="a few words about it" so visitors who can't see it, and search engines, know what it shows.`);
    }
    const id = el.attrs.find((a) => a.lname === "id")?.value;
    if (id) {
      if (ids.has(id)) add(el.start, el.tagEnd, "hint", (l) => `Two things share the id "${id}" (the other one is on line ${lineOf(starts, ids.get(id)!).line}, this is line ${l}). Each id should be used once.`);
      else ids.set(id, el.start);
    }
  }

  out.sort((a, b) => a.from - b.from);
  return out.slice(0, MAX_PROBLEMS);
}

/** One calm sentence for the strip above the code: "2 things to fix" or nothing at all. */
export function problemSummary(problems: CodeProblem[]): string {
  const errors = problems.filter((p) => p.severity === "error").length;
  const hints = problems.length - errors;
  if (errors === 0 && hints === 0) return "";
  const parts: string[] = [];
  if (errors) parts.push(errors === 1 ? "1 thing to fix" : `${errors} things to fix`);
  if (hints) parts.push(hints === 1 ? "1 suggestion" : `${hints} suggestions`);
  return parts.join(" and ");
}
