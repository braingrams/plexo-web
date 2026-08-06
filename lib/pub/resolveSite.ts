import type { BlogSite, PublishedDomain, SubscriptionPlan, Template } from "@prisma/client";
import { prisma } from "@/server/prisma";
import { getPagesDomain } from "@/server/pagesDomain";

const PUBLISHED_INCLUDE = {
  template: true,
  user: { select: { subscriptionPlan: true, hideBranding: true } },
  organization: { select: { id: true, logo: true, whiteLabelEnabled: true } },
} as const;

export type ResolvedPublishedDomain = PublishedDomain & {
  template: Template;
  user: { subscriptionPlan: SubscriptionPlan; hideBranding: boolean };
  organization: { id: string; logo: string | null; whiteLabelEnabled: boolean };
};

export type ResolveSiteResult =
  | { status: "not_found" }
  | { status: "suspended" }
  | { status: "ok"; published: ResolvedPublishedDomain };

/**
 * Resolves an incoming /pub/[domain] request to its PublishedDomain + root Template
 * ("the site"), including the ".localhost" -> "{pagesDomain}" dev-normalization
 * fallback (middleware.ts already does this before rewriting here — this fallback only
 * matters for direct /pub testing) and the active/suspended gate. Shared by the legacy
 * [[...slug]] catch-all route and every page under blog/**, so this lookup lives in
 * exactly one place instead of five near-identical copies.
 */
export async function resolveSite(rawDomain: string): Promise<ResolveSiteResult> {
  let published = await prisma.publishedDomain.findUnique({
    where: { domain: rawDomain },
    include: PUBLISHED_INCLUDE,
  });

  if (!published && rawDomain.endsWith(".localhost")) {
    const sub = rawDomain.replace(".localhost", "");
    published = await prisma.publishedDomain.findUnique({
      where: { domain: `${sub}.${getPagesDomain()}` },
      include: PUBLISHED_INCLUDE,
    });
  }

  if (!published) {
    return { status: "not_found" };
  }
  if (!published.active) {
    return { status: "suspended" };
  }
  return { status: "ok", published };
}

export type ResolveBlogSiteResult =
  | { status: "not_found" }
  | { status: "suspended" }
  | { status: "blog_disabled" }
  | { status: "ok"; published: ResolvedPublishedDomain; blogSite: BlogSite };

/**
 * resolveSite() plus the BlogSite lookup + enabled gate every blog page needs before it
 * can do anything else. "blog_disabled" covers both "no BlogSite row yet" (blog never
 * turned on for this site) and "BlogSite.enabled === false".
 */
export async function resolveBlogSite(rawDomain: string): Promise<ResolveBlogSiteResult> {
  const site = await resolveSite(rawDomain);
  if (site.status !== "ok") return site;

  const blogSite = await prisma.blogSite.findUnique({ where: { templateId: site.published.templateId } });
  if (!blogSite || !blogSite.enabled) {
    return { status: "blog_disabled" };
  }
  return { status: "ok", published: site.published, blogSite };
}
