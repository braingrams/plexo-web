import { User } from "@/lib/db/coreEntities";
import { CURRENT_ONBOARDING_VERSION } from "@/lib/dashboardV3/flag";

/**
 * Someone who PUSHES a brand or prototype from Strata into Plexo (the Strata publish flow, or a published brand reaching a linked site)
 * already knows what they are building and has a brand, so Plexo's onboarding questions are skipped: they land on Home and the Brand
 * page (their brand bible), not the setup wizard. Idempotent: running it again, or for someone who finished or deferred onboarding
 * themselves, changes nothing. Never throws (a failed save must not fail the publish).
 */
export type StrataPushUser = { onboardingVersion?: number | null } | null | undefined;

export type StrataPushDeps = {
  load(userId: string): Promise<StrataPushUser>;
  save(userId: string, patch: { onboardingVersion: number }): Promise<void>;
};

/** True when onboarding still has to be marked done for this user. */
export const needsOnboardingMark = (user: StrataPushUser): boolean => !!user && (user.onboardingVersion ?? 0) < CURRENT_ONBOARDING_VERSION;

export async function completeOnboardingForStrataPush(userId: string, deps: StrataPushDeps = realDeps): Promise<{ changed: boolean }> {
  try {
    const user = await deps.load(userId);
    if (!needsOnboardingMark(user)) return { changed: false };
    await deps.save(userId, { onboardingVersion: CURRENT_ONBOARDING_VERSION });
    return { changed: true };
  } catch (err) {
    console.warn(`[strata-push] ${userId}: couldn't mark onboarding done`, err instanceof Error ? err.message : err);
    return { changed: false };
  }
}

const realDeps: StrataPushDeps = {
  load: async (userId) => (await User.get({ id: userId }).go({ attributes: ["onboardingVersion"] })).data,
  save: async (userId, patch) => {
    await User.patch({ id: userId }).set(patch).go();
  },
};
