/**
 * SOL's one-time first-person hello ("Hi, I'm SOL..."), shared by every place SOL introduces itself: the SOL page, SOL inside
 * the app editor, the hub's first-site steps and the dashboard tour. The words live here (pure, no React) so they never drift.
 */
export const SOL_INTRO_HEADING = "Hi, I'm SOL.";
export const SOL_INTRO_BODY = "I can build and change your website for you — just tell me what you want.";
/** Tap one to start: plain words a site owner would actually say. */
export const SOL_INTRO_PROMPTS = ["Add a pricing page", "Make my homepage friendlier", "Write my About page"] as const;
export const SOL_INTRO_CTA = "Change something with SOL";
export const SOL_INTRO_HIDE_LABEL = "Hide this hello";
/** Per-browser copy of "already seen", so a returning owner never waits on the server to hide the card. The account keeps the real answer. */
export const SOL_INTRO_KEY = "plx:sol-intro:seen:v2";

/** Where an example opens SOL from a screen that is not SOL: a fresh chat with the words already in the box. */
export function solIntroHref(prompt: string): string {
  return `/dashboard/sol?new=1&draft=${encodeURIComponent(prompt)}`;
}

/** Whether to show the hello: only when the caller wants it and neither this browser nor the account has seen it. `serverSeen` is null while unknown. */
export function shouldShowSolIntro(o: { wanted: boolean; localSeen: boolean; serverSeen: boolean | null }): boolean {
  return o.wanted && !o.localSeen && o.serverSeen === false;
}
