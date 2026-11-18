import { User } from "@/lib/db/coreEntities";
import { freshCharisolIdToken } from "@/lib/charisolLink";
import { getCharisolVerifier } from "@/server/charisolVerifier";
import { isEmailVerifiedClaim } from "@/server/charisolAccount";
import { createStrataProjectFromSiteBrand, getSiteBrandState } from "@/lib/brand/siteBrand";
import { exchangeCharisolIdToken } from "./server";
import { strataApiUrl } from "./apiUrl";
import { loadStrataToken, saveStrataSession } from "./session";

/**
 * Connects Strata for someone with no clicks: Charisol is one sign-in for every Charisol product, so if they signed in to Plexo
 * with it we use that (same checks as the "Connect Strata" route: verified token, same email as the Plexo account). Returns
 * whether there is a usable Strata session afterwards. Never throws.
 */
export async function connectStrataInBackground(userId: string): Promise<boolean> {
  try {
    const base = strataApiUrl();
    if (!base) return false;
    if (await loadStrataToken(userId)) return true;
    const idToken = await freshCharisolIdToken(userId);
    if (!idToken) return false;
    const claims = (await getCharisolVerifier().verify(idToken)) as unknown as Record<string, unknown>;
    const { data: user } = await User.get({ id: userId }).go();
    const claimed = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
    if (!isEmailVerifiedClaim(claims.email_verified) || !claimed || claimed !== user?.email?.trim().toLowerCase()) return false;
    await saveStrataSession(userId, await exchangeCharisolIdToken(base, idToken));
    return true;
  } catch (err) {
    console.warn("[strata-auto] couldn't connect in the background", err instanceof Error ? err.message : err);
    return false;
  }
}

export type AutoSetupResult = { status: "created" | "already-linked" | "not-connected" | "failed"; projectName?: string };

type Deps = {
  isLinked: (siteId: string) => Promise<boolean>;
  connect: (userId: string) => Promise<boolean>;
  create: (input: { siteId: string; userId: string; organizationId: string }) => Promise<{ project: { name: string } }>;
};

const realDeps: Deps = {
  isLinked: async (siteId) => (await getSiteBrandState(siteId)).linked,
  connect: connectStrataInBackground,
  create: (input) => createStrataProjectFromSiteBrand({ ...input, autoSync: true }),
};

/**
 * A new website gets its brand set up in Strata by itself: connect in the background, make a Strata project named after the
 * site from its brand, link the site to it (keep in sync on). Safe to call any number of times: a site that already follows a
 * brand is left alone. Never throws and never blocks making the website: if anything isn't possible (no Charisol sign-in kept,
 * Strata unavailable, no colours yet) the website works exactly as before and the owner can connect from the Brand page.
 */
export async function ensureSiteBrandInStrata(input: { siteId: string; userId: string; organizationId: string }, deps: Deps = realDeps): Promise<AutoSetupResult> {
  try {
    if (await deps.isLinked(input.siteId)) return { status: "already-linked" };
    if (!(await deps.connect(input.userId))) return { status: "not-connected" };
    const made = await deps.create(input);
    return { status: "created", projectName: made.project.name };
  } catch (err) {
    console.warn(`[strata-auto] ${input.siteId}: couldn't set up the brand in Strata`, err instanceof Error ? err.message : err);
    return { status: "failed" };
  }
}
