import { Template, PublishedDomain } from "@/lib/db/contentEntities";
import { assertCanPutSiteLive } from "@/lib/plan/publishGuard";
import { RESERVED_SUBDOMAINS, SUBDOMAIN_REGEX } from "@/lib/sites/linkDomain";
import { getPagesDomain } from "@/server/pagesDomain";

// Publishing a Strata prototype to Plexo (POST /api/v1/strata/projects/<id>/publish). The
// deploy itself is lib/projects/deploy.ts; this adds what Strata's people need around it:
// publishing the same Strata project again updates the same app (and keeps its address), and
// an address that can't be used is explained BEFORE the build starts — the build pipeline
// only discovers that at the very end, after minutes of work.

export class StrataPublishError extends Error {
  constructor(message: string, public readonly status = 400, public readonly code = "invalid") {
    super(message);
  }
}

/** The app this organisation already published from that Strata project, if any. */
export async function findAppForStrataProject(organizationId: string, strataProjectId: string): Promise<{ id: string; name: string } | null> {
  const { data } = await Template.query.byOrg({ organizationId }).go({ pages: "all", attributes: ["id", "name", "sourceType", "strataProjectId"] });
  const match = data.find((t) => t.sourceType === "REACT_PROJECT" && t.strataProjectId === strataProjectId);
  return match ? { id: match.id, name: match.name } : null;
}

/** Remembers which Strata project an app came from. */
export async function linkAppToStrataProject(appId: string, strataProjectId: string): Promise<void> {
  await Template.patch({ id: appId }).set({ strataProjectId }).go();
}

/**
 * Checks a requested plexopages address in plain language: spelling, reserved words, someone
 * else already using it, and the plan's live-site limit. `appId` is the app being updated
 * (absent for a first publish). Returns the cleaned-up subdomain, or undefined if none asked for.
 */
export async function checkSubdomain(
  actor: { userId: string; organizationId: string; subscriptionPlan: string },
  requested: unknown,
  appId?: string,
): Promise<string | undefined> {
  if (requested === undefined || requested === null || requested === "") {
    await assertCanPutSiteLive(actor, appId ?? "new-app", "SUBDOMAIN");
    return undefined;
  }
  if (typeof requested !== "string") throw new StrataPublishError("The address should be text, like \"my-shop\".");
  const slug = requested.trim().toLowerCase();
  const pages = getPagesDomain();
  if (slug.includes(".")) throw new StrataPublishError(`Send just the first part of the address (like "my-shop" for my-shop.${pages}), not the whole domain.`, 400, "subdomain_invalid");
  if (slug.length < 3 || slug.length > 40 || !SUBDOMAIN_REGEX.test(slug)) {
    throw new StrataPublishError("Addresses are 3–40 letters, numbers or hyphens, and can't start or end with a hyphen.", 400, "subdomain_invalid");
  }
  if (slug.includes("--")) throw new StrataPublishError("Addresses can't contain two hyphens in a row. Try a single hyphen.", 400, "subdomain_invalid");
  if (RESERVED_SUBDOMAINS.has(slug)) throw new StrataPublishError(`"${slug}" is kept by Plexo. Pick another address.`, 409, "subdomain_taken");
  const { data } = await PublishedDomain.query.byDomain({ domain: `${slug}.${pages}` }).go({ pages: "all" });
  const taken = data[0];
  if (taken && (taken.organizationId !== actor.organizationId || (appId && taken.templateId !== appId))) {
    throw new StrataPublishError(`${slug}.${pages} is already taken. Pick another address.`, 409, "subdomain_taken");
  }
  await assertCanPutSiteLive(actor, appId ?? "new-app", "SUBDOMAIN");
  return slug;
}

/**
 * Puts the Strata project that was just published onto the app's Brand page: the app's brand is the project it came from. Needs the
 * person's Strata session, which Plexo opens quietly for people signed in with Charisol. Never throws and never fails the publish:
 * if it can't be done now, the Brand page connects it by itself the next time it is opened.
 */
export async function linkPushedAppToBrand(input: { appId: string; strataProjectId: string; userId: string; organizationId: string }): Promise<boolean> {
  try {
    const { connectStrataInBackground } = await import("@/lib/strata/autoSetup");
    const { linkSiteBrand, getSiteBrandState } = await import("@/lib/brand/siteBrand");
    if ((await getSiteBrandState(input.appId)).linked) return true;
    await connectStrataInBackground(input.userId);
    await linkSiteBrand({ siteId: input.appId, userId: input.userId, organizationId: input.organizationId, projectId: input.strataProjectId, autoSync: true });
    return true;
  } catch (err) {
    console.warn(`[strata-publish] ${input.appId}: brand not linked yet`, err instanceof Error ? err.message : err);
    return false;
  }
}
