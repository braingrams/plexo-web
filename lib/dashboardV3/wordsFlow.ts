/**
 * The guided "Change the words" walk-through: one page at a time, a look at it first, then Edit / Next / Skip, and a clear
 * "Done, back to home" at the end. Pure helpers (which pages, which step, where Edit goes and how it comes back) so the rules are tested once.
 */
import type { HubPage } from "./hubData";
import { siteHubHref } from "./hubPaths";
import { pageLabel } from "./pagesList";

export type WordsTopic = "words" | "contact" | "links";

export const wordsFlowHref = (siteId: string, topic: WordsTopic = "words", step?: number) =>
  `/dashboard/sites/${siteId}/words?for=${topic}${step && step > 0 ? `&step=${step}` : ""}`;

export function parseTopic(raw: string | string[] | null | undefined): WordsTopic {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "contact" || v === "links" ? v : "words";
}

/** The pages worth walking through: the ones people can edit with blocks or code (not apps) and that the plan still shows. Home first. */
export function walkPages(pages: HubPage[]): HubPage[] {
  return pages.filter((p) => p.sourceType !== "REACT_PROJECT" && !p.archivedByPlan).sort((a, b) => Number(b.isRoot) - Number(a.isRoot));
}

/** The step number from the address (1 = first page). Anything odd means the first page; past the end means "all done". */
export function parseStep(raw: string | string[] | null | undefined, total: number): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = Number.parseInt(v ?? "", 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, total + 1);
}

/** Only ever send people back to somewhere inside their own dashboard (never another website, never a protocol-relative link). */
export function safeBackHref(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith("/dashboard") || raw.startsWith("//") || raw.includes("\\") || /[\r\n]/.test(raw)) return null;
  return raw;
}

/** Opens the page's editor and makes its Back button come back to this step of the walk-through. */
export function editHrefWithBack(editHref: string, backHref: string): string {
  return `${editHref}${editHref.includes("?") ? "&" : "?"}back=${encodeURIComponent(backHref)}`;
}

export type StepCopy = { title: string; lead: string; editLabel: string; nextLabel: string; skipLabel: string };

const LEAD: Record<WordsTopic, string> = {
  words: "Here is how it looks now. You can change anything on it, live, right on the page: open the editor, tap any words and type your own. Pictures and buttons work the same way.",
  contact: "Here is how it looks now. To add your phone, email or address, open the editor and tap the words to type yours. Skip any page that doesn't need them.",
  links: "Here is how it looks now. To add your links, open the editor and tap a button or a line of words, then paste the link. Skip any page that doesn't need them.",
};

export function stepCopy(page: Pick<HubPage, "name" | "isRoot">, index: number, total: number, topic: WordsTopic): StepCopy {
  const last = index === total;
  return {
    title: `${pageLabel(page)} page`,
    lead: LEAD[topic],
    editLabel: "Edit this page",
    nextLabel: last ? "Looks good, finish" : "Looks good, next page",
    skipLabel: last ? "Skip and finish" : "Skip this page",
  };
}

export function doneCopy(topic: WordsTopic, edited: boolean): { title: string; body: string } {
  const what = topic === "contact" ? "contact details" : topic === "links" ? "links" : "words";
  return {
    title: "All done. Nicely done!",
    body: edited ? `Your ${what} are saved. Back on your home screen there is a next step waiting for you.` : `You can come back to this any time. Back on your home screen there is a next step waiting for you.`,
  };
}

export const WORDS_HOME_HREF = "/dashboard";
export { siteHubHref };
