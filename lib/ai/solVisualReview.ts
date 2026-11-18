// Visual self-critique: after the quality gate passes, SOL looks at screenshots of the page it just built (desktop
// and phone) and fixes anything clearly off, with at most ONE extra fix round per turn. Works for draft pages
// through a short-lived signed preview address (lib/draftPreviewToken.ts, lib/projects/draftScreenshot.ts).
// Always fails open: any error or timeout skips the step and the turn carries on normally.

import { modelSupportsImages } from "@/lib/ai/modelRegistry";
import type { AiProvider, ConcreteTier } from "@/lib/ai/types";
import type { DraftShot } from "@/lib/projects/draftScreenshot";

export const VISUAL_REVIEW_TIMEOUT_MS = 45_000;
/** The reply that means "nothing to fix"; it is never shown to the owner. */
export const VISUAL_OK_MARKER = "LOOKS_GOOD";

export const VISUAL_REVIEW_PROMPT =
  `Look at the desktop and phone screenshots of the page you just built. Is anything visually off: overlapping or cramped elements, unreadable text, empty or broken image areas, awkward spacing, weak hierarchy, off-brand colours? Fix anything clearly wrong with one more page_edit. If nothing is clearly wrong, reply with exactly ${VISUAL_OK_MARKER} and nothing else. Never mention this check to the owner.`;

export type VisualReviewState = {
  /** The review has been offered this turn (it never runs twice). */
  done: boolean;
  /** The first page built or edited this turn: the only one reviewed. */
  target?: string;
  /** The answer the model gave before the review; shown if the review finds nothing to fix. */
  candidate?: { text: string; content: unknown[] };
  /** The review round is the one now running. */
  reviewing: boolean;
};
export const newVisualState = (): VisualReviewState => ({ done: false, reviewing: false });

/** Remembers the first page touched this turn. */
export function noteTouchedPage(state: VisualReviewState, ids: string[]): void {
  if (!state.target && ids.length) state.target = ids[0];
}

export function visualReviewEnabled(provider: AiProvider, tier: ConcreteTier, env: Record<string, string | undefined> = process.env): boolean {
  if (/^(off|false|0)$/i.test(env.SOL_VISUAL_REVIEW ?? "")) return false;
  return modelSupportsImages(provider, tier);
}

export function isLooksGood(text: string): boolean {
  return text.replace(/[^A-Za-z_]/g, "").toUpperCase() === VISUAL_OK_MARKER;
}

const LABEL: Record<string, string> = { "desktop:top": "Desktop, top of the page.", "desktop:full": "Desktop, the whole page.", "phone:top": "Phone, top of the page." };

/** The user message for the review round: pictures, then the instruction. */
export function visualReviewContent(shots: DraftShot[]): unknown[] {
  const blocks: unknown[] = [];
  for (const s of shots) {
    blocks.push({ type: "text", text: LABEL[`${s.device}:${s.kind}`] ?? "Screenshot." });
    blocks.push({ type: "image", source: { type: "url", url: s.imageUrl } });
  }
  blocks.push({ type: "text", text: VISUAL_REVIEW_PROMPT });
  return blocks;
}

export type ReviewDeps = {
  /** Finds the site root and page for a template id (lazy real implementation below). */
  resolveTarget: (templateId: string) => Promise<{ templateId: string; pageId: string | null } | null>;
  shoot: (t: { templateId: string; pageId: string | null }) => Promise<DraftShot[]>;
  timeoutMs?: number;
};

/** Screenshots for the review, or null on any failure or timeout (fail open). */
export async function captureForReview(target: string, deps: ReviewDeps): Promise<DraftShot[] | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = (async () => {
      const t = await deps.resolveTarget(target);
      if (!t) return null;
      return await deps.shoot(t);
    })();
    work.catch(() => {}); // a late failure after the timeout must not surface
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), deps.timeoutMs ?? VISUAL_REVIEW_TIMEOUT_MS);
    });
    const shots = await Promise.race([work, timeout]);
    return shots && shots.length ? shots : null;
  } catch (err) {
    console.warn("[sol] visual review skipped:", err instanceof Error ? err.message : err);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Real dependencies for an owner: lazy imports keep this file cheap to test. */
export function reviewDepsFor(resolved: { organizationId: string; userId: string }): ReviewDeps {
  return {
    resolveTarget: async (id) => {
      const [{ loadOwnedRow }, { findRootTemplateId }] = await Promise.all([import("@/lib/mcp/v2Pages"), import("@/lib/siteLayoutCore")]);
      const row = await loadOwnedRow(resolved as never, id);
      if (row.sourceType === "REACT_PROJECT") return null;
      const rootId = await findRootTemplateId(row.id, row.parentId ?? null);
      return { templateId: rootId, pageId: rootId === row.id ? null : row.id };
    },
    shoot: async (t) => {
      const { screenshotDraftPage } = await import("@/lib/projects/draftScreenshot");
      return screenshotDraftPage({ ...t, device: "both", userId: resolved.userId });
    },
  };
}
