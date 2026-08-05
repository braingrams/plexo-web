import type { AiActionMode, ConcreteTier } from "./types";

const HIGH_SIGNAL_PHRASES = [
  "entire", "full page", "full layout", "redesign", "rebuild", "rewrite everything",
  "multi-section", "multiple sections", "whole template", "from scratch",
  "landing page for", "complete", "overhaul", "every section", "whole page",
];

const LOW_SIGNAL_PHRASES = [
  "color", "colour", "bold", "italic", "font size", "padding", "margin",
  "align", "capitalize", "rename", "shorter", "smaller", "bigger", "underline",
];

/**
 * Free heuristic used only when the account's aiTier is AUTO — deliberately
 * not an extra model call, to keep AUTO cheap and fast. Upgradeable later to
 * a real classifier call if this proves too coarse.
 */
export function classifyPromptComplexity(mode: AiActionMode, prompt: string): ConcreteTier {
  const text = prompt.toLowerCase();
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const hasHighSignal = HIGH_SIGNAL_PHRASES.some((phrase) => text.includes(phrase));

  if (mode === "generate_layout" || mode === "edit_raw_html") {
    // A full-document edit/generation is inherently a large operation — same bias
    // toward HIGH as generate_layout, rather than the smaller-edit heuristics below.
    return hasHighSignal || wordCount > 40 ? "HIGH" : "MEDIUM";
  }

  if (hasHighSignal || wordCount > 40) {
    return "HIGH";
  }

  if (mode === "edit_element") {
    const hasLowSignal = LOW_SIGNAL_PHRASES.some((phrase) => text.includes(phrase));
    if (wordCount <= 20 && hasLowSignal) return "BASIC";
    return wordCount <= 12 ? "BASIC" : "MEDIUM";
  }

  // edit_layout
  return "MEDIUM";
}
