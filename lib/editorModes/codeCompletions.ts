import { snippetCompletion, type Completion, type CompletionSource } from "@codemirror/autocomplete";
import { htmlLanguage } from "@codemirror/lang-html";
import type { Extension } from "@codemirror/state";
import { ATTRIBUTE_SUGGESTIONS, COMMON_CLASSES, COMPONENT_SNIPPETS, classesInPage, cursorContext, tokenSuggestions, type Suggestion } from "./completions";

const toCompletion = (s: Suggestion, type: string, boost = 0): Completion => ({ label: s.label, detail: s.detail, type, boost });

/**
 * Adds the site's design tokens, Plexo's ready-made parts and class names to the HTML editor's own suggestions.
 * `getHtml` is read on demand so "classes this page already uses" stay current as the page is edited.
 */
export function plexoCompletions(opts: { siteTokens?: Record<string, string> | null; getHtml: () => string }): Extension {
  const tokens = tokenSuggestions(opts.siteTokens).map((s) => toCompletion(s, "variable", 2));
  const parts: Completion[] = COMPONENT_SNIPPETS.map((s) => snippetCompletion(s.apply ?? "", { label: `<${s.label}`, displayLabel: s.label, detail: s.detail ?? "Plexo part", type: "class", boost: 3 }));
  const attrs = ATTRIBUTE_SUGGESTIONS.map((s) => toCompletion(s, "property", 2));
  const common = COMMON_CLASSES.map((c) => ({ label: c, type: "constant", boost: -1 }) as Completion);

  const source: CompletionSource = (context) => {
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);
    const cur = cursorContext(before);
    if (!cur) return null;
    const from = line.from + cur.from;
    if (cur.kind === "token") return { from, options: tokens, validFor: /^--[\w-]*$/ };
    if (cur.kind === "tag") return { from, options: parts, validFor: /^<[\w-]*$/ };
    if (cur.kind === "attr") return { from, options: attrs, validFor: /^[\w-]*$/ };
    const used = classesInPage(opts.getHtml()).map((c) => ({ label: c, detail: "on this page", type: "constant", boost: 1 }) as Completion);
    const seen = new Set(used.map((u) => u.label));
    return { from, options: [...used, ...common.filter((c) => !seen.has(c.label))], validFor: /^[\w:\-/[\].%]*$/ };
  };
  return htmlLanguage.data.of({ autocomplete: source });
}
