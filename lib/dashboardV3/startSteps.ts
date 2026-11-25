/**
 * The "Your website is ready, here's what to do next" steps on a brand-new site's hub. Pure, so the order, the states and
 * the one main button are tested. It uses the same facts as Home's "Finish up" list (lib/dashboardV3/tasks.ts) and the same
 * step names ("Review and edit your pages", "Add your logo and colours"), so both landings tell one story.
 */
import { hubTabHref } from "./hubTabs";

export type StartFacts = {
  /** Which kind of site this is: only a visual-editor site that is not online yet gets the steps. */
  eligible: boolean;
  /** The site has been put online at least once. */
  published: boolean;
  hasAddress: boolean;
  /** This site's own logo and colours are set (or "no logo" was chosen). */
  brandDone: boolean;
  /** The owner changed something since it was made. */
  edited: boolean;
  /** The owner opened the editor from this panel (remembered on the site, on the server: Template.startReviewedAt). */
  openedEditor: boolean;
  /** SOL already tailored the words to the owner's business. */
  personalizedWithSol: boolean;
};

export type StartStepId = "review" | "brand" | "address" | "publish";
export type StartStep = {
  id: StartStepId;
  title: string;
  body: string;
  state: "done" | "next" | "later";
  /** The one big button of the whole panel. */
  primary: boolean;
  cta: string;
  /** A link for the step's button; "edit" and "publish" are done by the panel itself. */
  href: string | null;
  action: "link" | "edit" | "publish";
};
export type StartSteps = { show: boolean; steps: StartStep[]; primaryId: StartStepId | null; doneCount: number; reviewed: boolean; editLabel: string };

export const START_TITLE = "Your website is ready. Here's what to do next";
export const START_INTRO = "We started you with a ready-made design, filled in with your details. It isn't online yet, so nobody can see it until you publish.";
export const EDIT_LABEL_NEW = "Review and edit your pages";
export const EDIT_LABEL_LIVE = "Edit website";

export function computeStartSteps(siteId: string, f: StartFacts): StartSteps {
  if (!f.eligible || f.published) return { show: false, steps: [], primaryId: null, doneCount: 0, reviewed: true, editLabel: EDIT_LABEL_LIVE };
  // SOL already wrote the words, colours and details, so a SOL-personalized site counts as reviewed from the start.
  const reviewed = f.edited || f.openedEditor || f.personalizedWithSol;
  const done: Record<StartStepId, boolean> = { review: reviewed, brand: f.brandDone, address: f.hasAddress, publish: false };
  // The main button follows the order that matters: look it over, then the address, then publish. The logo is optional, so it never blocks.
  const primaryId: StartStepId = !done.review ? "review" : !done.address ? "address" : "publish";
  const defs: Omit<StartStep, "state" | "primary">[] = [
    {
      id: "review",
      title: "Review and edit your pages",
      body: f.personalizedWithSol ? "SOL built this first draft from what you told it. Change any words, pictures or colours, and ask SOL if you want something rewritten." : "We started you with a design filled in with your details. Change any words, pictures or colours.",
      cta: reviewed ? "Keep editing" : EDIT_LABEL_NEW,
      href: null,
      action: "edit",
    },
    { id: "brand", title: "Add your logo and colours", body: "So your site looks like you. You can skip this and come back later.", cta: f.brandDone ? "Change logo and colours" : "Add logo and colours", href: hubTabHref(siteId, "brand"), action: "link" },
    { id: "address", title: "Choose your web address", body: "The link people type to visit you, like amas-kitchen.plexopages.com.", cta: f.hasAddress ? "Change web address" : "Choose web address", href: hubTabHref(siteId, "address"), action: "link" },
    {
      id: "publish",
      title: "Publish your website",
      body: f.hasAddress ? "This puts your site online so anyone can visit it. You can keep editing and publish again any time." : "Choose your web address first, then you can put your site online.",
      cta: "Publish my website",
      href: null,
      action: "publish",
    },
  ];
  const steps: StartStep[] = defs.map((d) => ({ ...d, primary: d.id === primaryId, state: done[d.id] ? "done" : d.id === "publish" && !f.hasAddress ? "later" : "next" }));
  return { show: true, steps, primaryId, doneCount: steps.filter((s) => s.state === "done").length, reviewed, editLabel: reviewed ? EDIT_LABEL_LIVE : EDIT_LABEL_NEW };
}
