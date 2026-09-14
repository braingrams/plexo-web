import { BlogPost } from "@/lib/db/contentEntities";
import { getTierFeatures } from "@/lib/subscription";

export const QUOTA_EXCEEDED = "QUOTA_EXCEEDED" as const;

export type PublishQuotaStatus = {
  plan: string;
  limit: number | null;
  count: number;
};

/** Counts only PUBLISHED posts directly off BlogPost.byStatus's GSI1 (sk begins
 * "PUBLISHED#…"), instead of fetching every status and filtering in memory. */
export async function countPublishedBlogPosts(
  templateId: string,
): Promise<number> {
  const { data } = await BlogPost.query
    .byStatus({ templateId, status: "PUBLISHED" })
    .go({ pages: "all" });
  return data.length;
}

// Takes `plan` as a plain string rather than resolving it from organizationId itself —
// every caller already has it cheaply (resolveUser's subscriptionPlan for HTTP routes,
// LambdaResolvedUser's for MCP/SOL), and resolving org->owner->plan here would mean
// importing server/orgDynamo.ts, which pulls in `next/headers` — exactly the kind of
// import lib/mcp/blogTools.ts (reachable from the standalone SOL Lambda bundle, see
// lib/blog/savePostCore.ts's own comment on the equivalent next/cache problem) can't have
// anywhere in its import graph.
export async function getPublishedBlogPostQuotaStatus(
  templateId: string,
  plan: string,
): Promise<PublishQuotaStatus> {
  const count = await countPublishedBlogPosts(templateId);
  return { plan, limit: getTierFeatures(plan).maxPublishedBlogPosts, count };
}

export type QuotaCheckResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      code: typeof QUOTA_EXCEEDED;
      plan: string;
      limit: number;
      count: number;
    };

/** Verifies a create-or-transition-to-PUBLISHED is within the org's plan quota. Callers
 * are expected to only invoke this when the save would actually result in a new
 * PUBLISHED post (a plain edit of an already-published post shouldn't re-check). */
export async function assertPublishedBlogPostQuota(
  templateId: string,
  plan: string,
): Promise<QuotaCheckResult> {
  const status = await getPublishedBlogPostQuotaStatus(templateId, plan);
  if (status.limit === null || status.count < status.limit) return { ok: true };
  return {
    ok: false,
    error: `Your plan allows a maximum of ${status.limit} published blog posts. Upgrade to publish more.`,
    code: QUOTA_EXCEEDED,
    plan: status.plan,
    limit: status.limit,
    count: status.count,
  };
}

export function formatPublishedQuotaLabel(
  count: number,
  limit: number | null,
): string {
  return limit === null ? "Unlimited" : `${count} / ${limit} published`;
}
