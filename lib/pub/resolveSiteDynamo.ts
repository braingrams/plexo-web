import { EntityItem } from "electrodb";
import { getPagesDomain } from "@/server/pagesDomain";
import { Template, PublishedDomain, BlogSite } from "@/lib/db/contentEntities";
import { User, Organization } from "@/lib/db/coreEntities";

// DynamoDB-stack port of lib/pub/resolveSite.ts — same behavior, same rationale (see that
// file's comments), just backed by PublishedDomain/Template/User/Organization/BlogSite
// entity queries instead of Prisma. Only the callers actually being cut over to DynamoDB
// import this; every other caller (the blog public-rendering tree, the [[...slug]] site
// renderer — the largest still-undone piece of the Content context) stays on the
// Prisma-backed original until that rendering path itself gets ported.

export type ResolvedPublishedDomain = EntityItem<typeof PublishedDomain> & {
  template: EntityItem<typeof Template>;
  user: { subscriptionPlan: string; hideBranding: boolean };
  organization: { id: string; logo: string | null; whiteLabelEnabled: boolean };
};

export type ResolveSiteResult =
  | { status: "not_found" }
  | { status: "suspended" }
  | { status: "ok"; published: ResolvedPublishedDomain };

/**
 * Resolves an incoming /pub/[domain] request to its PublishedDomain + root Template
 * ("the site"), including the ".localhost" -> "{pagesDomain}" dev-normalization
 * fallback and the active/suspended gate.
 */
export async function resolveSite(rawDomain: string): Promise<ResolveSiteResult> {
  let domain = rawDomain;
  let { data: matches } = await PublishedDomain.query.byDomain({ domain }).go();

  if (matches.length === 0 && rawDomain.endsWith(".localhost")) {
    const sub = rawDomain.replace(".localhost", "");
    domain = `${sub}.${getPagesDomain()}`;
    ({ data: matches } = await PublishedDomain.query.byDomain({ domain }).go());
  }

  const domainRow = matches[0];
  if (!domainRow) {
    return { status: "not_found" };
  }
  if (!(domainRow.active ?? true)) {
    return { status: "suspended" };
  }

  const [{ data: template }, { data: user }, { data: organization }] = await Promise.all([
    Template.get({ id: domainRow.templateId }).go(),
    User.get({ id: domainRow.userId }).go(),
    Organization.get({ id: domainRow.organizationId }).go(),
  ]);
  if (!template) return { status: "not_found" };

  const published: ResolvedPublishedDomain = {
    ...domainRow,
    template,
    user: { subscriptionPlan: user?.subscriptionPlan ?? "FREE", hideBranding: user?.hideBranding ?? false },
    organization: { id: domainRow.organizationId, logo: organization?.logo ?? null, whiteLabelEnabled: organization?.whiteLabelEnabled ?? false },
  };

  return { status: "ok", published };
}

export type ResolveBlogSiteResult =
  | { status: "not_found" }
  | { status: "suspended" }
  | { status: "blog_disabled" }
  | { status: "ok"; published: ResolvedPublishedDomain; blogSite: EntityItem<typeof BlogSite> };

/**
 * resolveSite() plus the BlogSite lookup + enabled gate every blog page needs before it
 * can do anything else. "blog_disabled" covers both "no BlogSite row yet" (blog never
 * turned on for this site) and "BlogSite.enabled === false".
 */
export async function resolveBlogSite(rawDomain: string): Promise<ResolveBlogSiteResult> {
  const site = await resolveSite(rawDomain);
  if (site.status !== "ok") return site;

  const { data: blogSite } = await BlogSite.get({ templateId: site.published.template.id }).go();
  if (!blogSite || !blogSite.enabled) {
    return { status: "blog_disabled" };
  }
  return { status: "ok", published: site.published, blogSite };
}
