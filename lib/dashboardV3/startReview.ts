/**
 * "Has the owner reviewed this site?" — one answer for the hub's next-steps panel and Home's "Review and edit your pages" step.
 * It is true when the owner changed something after the site was made, or when they opened the editor from the panel
 * (the server remembers that per site in Template.startReviewedAt, so it follows them across devices). Pure.
 */

/** Changing a site's updatedAt by writing the flag must not count as the owner editing it. */
export const START_REVIEW_FLAG_WINDOW_MS = 5_000;
/** A site counts as edited once it was last written this long after it was created. */
export const EDITED_AFTER_MS = 120_000;

type Stamps = { createdAt?: string | null; updatedAt?: string | null; startReviewedAt?: string | null };

/**
 * The owner changed the site since it was made. Writing startReviewedAt also bumps updatedAt, so a last write that lands
 * right on the flag is the flag itself and is not an edit.
 */
export function editedByOwner(t: Stamps | null | undefined): boolean {
  if (!t) return false;
  const created = t.createdAt ? Date.parse(t.createdAt) : NaN;
  const updated = t.updatedAt ? Date.parse(t.updatedAt) : NaN;
  if (!Number.isFinite(created) || !Number.isFinite(updated) || updated - created <= EDITED_AFTER_MS) return false;
  const flagged = t.startReviewedAt ? Date.parse(t.startReviewedAt) : NaN;
  if (Number.isFinite(flagged) && Math.abs(updated - flagged) <= START_REVIEW_FLAG_WINDOW_MS) return false;
  return true;
}

/** Reviewed = the owner opened the editor from the steps (server flag) or edited something. */
export function reviewedByOwner(t: Stamps | null | undefined): boolean {
  return !!t?.startReviewedAt || editedByOwner(t);
}

/**
 * Whether the route should write the flag now. An edited site is already reviewed, and writing would only move updatedAt,
 * so nothing is written for it; a site that already has the flag is left alone too.
 */
export function shouldWriteReviewFlag(t: Stamps | null | undefined): boolean {
  return !!t && !t.startReviewedAt && !editedByOwner(t);
}
