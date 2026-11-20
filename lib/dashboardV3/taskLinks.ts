/**
 * Where each "link" step on Home sends the owner, what the button says, and what SOL is asked if they'd
 * rather not do it themselves. Pure, so every step has one tested destination (no step ever just opens
 * "the site" and leaves the owner to hunt).
 */
import type { TaskId } from "./tasks";
import { siteHubHref } from "./hubPaths";
import { wordsFlowHref } from "./wordsFlow";

export type TaskLink = {
  /** The place the step is actually done. */
  href: string;
  /** What the button does, in plain words. */
  label: string;
  /** A prefilled message for SOL ("Ask SOL to do it"). */
  solHref: string;
};

const solHref = (prompt: string) => `/dashboard/sol?new=1&draft=${encodeURIComponent(prompt)}`;

type Place = { tab: string | null; label: string; ask: (site: string) => string; /** A guided walk-through of every page instead of a tab. */ guided?: "words" | "contact" | "links" };

const PLACES: Partial<Record<TaskId, Place>> = {
  brand: { tab: "brand", label: "Add logo and colours", ask: (s) => `Set up my logo and brand colours on my site "${s}". Use the logo and colours from my profile if I have them, and apply them across all my pages. ` },
  words: { tab: "pages", guided: "words", label: "Change the words", ask: (s) => `Go through the words on every page of my site "${s}" and tidy them so they sound like me. Tell me what you changed. ` },
  contact: { tab: "pages", guided: "contact", label: "Add my contact details", ask: (s) => `Add my contact details (phone, email and where to find me) to my site "${s}". Ask me for anything you need. ` },
  links: { tab: "pages", guided: "links", label: "Add my links", ask: (s) => `Add my links to my site "${s}". Ask me for the ones you need. ` },
  post: { tab: "blog", label: "Write a post", ask: (s) => `Help me write my first blog post for "${s}". Ask me what it's about, then draft it. ` },
  lesson: { tab: "course", label: "Add a lesson", ask: (s) => `Help me add my first lesson to the course on "${s}". Ask me what it teaches, then draft it. ` },
  price: { tab: "course", label: "Set the price", ask: (s) => `Help me set the price for my course on "${s}", or make it free. ` },
  signin: { tab: "app", label: "Turn on sign-in", ask: (s) => `Turn on sign-in (accounts people can make and come back to) for my app "${s}". ` },
  live: { tab: "app", label: "Put my app online", ask: (s) => `Put my app "${s}" online and tell me the link. ` },
  describe: { tab: null, label: "Describe my app to SOL", ask: (s) => `I want to build an app called "${s}". Ask me what it should do, then build it. ` },
};

/** The destination for a step, or null when it is finished on Home itself (address, product, pay, go live...). */
export function taskLink(id: TaskId, siteId: string, siteName: string): TaskLink | null {
  const place = PLACES[id];
  if (!place) return null;
  const ask = solHref(place.ask(siteName));
  return { href: place.guided ? wordsFlowHref(siteId, place.guided) : place.tab ? siteHubHref(siteId, place.tab) : ask, label: place.label, solHref: ask };
}
