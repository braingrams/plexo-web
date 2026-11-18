/** Tiny window-event API so any shell, menu item or error boundary can talk to <FeedbackNudge />. */
export const OPEN_FEEDBACK_EVENT = "plexo:open-feedback";
export const STRUGGLE_EVENT = "plexo:struggle";

/** Open the same feedback form the nudge opens (used by the "Feedback" menu item in every shell). */
export function openFeedback(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(OPEN_FEEDBACK_EVENT));
}

/** Let an error boundary say "this page crashed" without importing the detector. */
export function reportStruggle(signal: "boundary" | "js_error"): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(STRUGGLE_EVENT, { detail: { signal } }));
}
