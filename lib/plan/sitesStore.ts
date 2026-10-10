import { UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { docClient } from "@/lib/db/client";
import { Member } from "@/lib/db/coreEntities";
import { PublishedDomain, Template } from "@/lib/db/contentEntities";
import type { PlanSite } from "./siteLimits";

// Loads the sites an account's plan governs, and writes the plan's flags onto them.

export type GovernedSite = PlanSite & {
  organizationId: string;
  sourceType: string;
  /** Another account published an address for this site — their plan governs how it's served. */
  sharedWithOtherPlan: boolean;
};

const TEMPLATE_ATTRIBUTES = [
  "id", "userId", "organizationId", "name", "kind", "parentId", "sourceType", "createdAt", "updatedAt",
  "isPublished", "planArchivedAt", "isBlogLayout", "isSiteLayoutFragment", "isCommerceLayout", "isLmsPageDesign", "marketplaceStatus",
] as const;

/**
 * Every site whose serving this account's plan decides: a site it created, or one it put
 * live at an address (PublishedDomain.userId — the serve route applies the plan of
 * whoever published the address). Only the account's own addresses are listed per site.
 */
export async function listGovernedSites(userId: string): Promise<GovernedSite[]> {
  const { data: memberships } = await Member.query.byUser({ userId }).go({ pages: "all" });
  const organizationIds = [...new Set(memberships.map((m) => m.organizationId))];

  const perOrg = await Promise.all(
    organizationIds.map(async (organizationId) => {
      const { data: templates } = await Template.query
        .byOrg({ organizationId })
        .go({ pages: "all", attributes: [...TEMPLATE_ATTRIBUTES] });
      const childrenOf = new Map<string, typeof templates>();
      for (const t of templates) {
        if (!t.parentId) continue;
        const list = childrenOf.get(t.parentId) ?? [];
        list.push(t);
        childrenOf.set(t.parentId, list);
      }
      const roots = templates.filter(
        (t) => !t.parentId && t.kind === "LANDING_PAGE" && !t.marketplaceStatus && !t.isBlogLayout && !t.isSiteLayoutFragment && !t.isCommerceLayout && !t.isLmsPageDesign,
      );
      const sites = await Promise.all(
        roots.map(async (root): Promise<GovernedSite | null> => {
          const { data: rows } = await PublishedDomain.query.primary({ templateId: root.id }).go({ pages: "all" });
          const own = rows.filter((d) => d.userId === userId);
          if (root.userId !== userId && own.length === 0) return null;
          const pages: PlanSite["pages"] = [];
          const stack = [...(childrenOf.get(root.id) ?? [])];
          while (stack.length) {
            const page = stack.pop()!;
            pages.push({ id: page.id, isPublished: page.isPublished, planArchivedAt: page.planArchivedAt, updatedAt: page.updatedAt });
            stack.push(...(childrenOf.get(page.id) ?? []));
          }
          return {
            id: root.id,
            name: root.name,
            organizationId,
            sourceType: root.sourceType ?? "BUILDER",
            createdAt: root.createdAt,
            updatedAt: root.updatedAt,
            pages,
            domains: own.map((d) => ({
              id: d.id,
              templateId: d.templateId,
              domain: d.domain,
              type: d.type,
              active: d.active,
              planDisabledAt: d.planDisabledAt,
              planFallback: d.planFallback,
            })),
            sharedWithOtherPlan: rows.some((d) => d.userId !== userId && d.active !== false && !d.planDisabledAt),
          };
        }),
      );
      return sites.filter((s): s is GovernedSite => s !== null);
    }),
  );
  return perOrg.flat();
}

/**
 * Sets a page's publish flags WITHOUT bumping its updatedAt. An ElectroDB patch would stamp
 * "edited just now" on every page a downgrade or upgrade touches — reordering the
 * dashboard's recently-edited lists and corrupting "the most recently edited site stays
 * live" the next time Free's limits are applied.
 */
export async function setPagePublishFlags(templateId: string, published: boolean, archivedAt: string | null): Promise<void> {
  const { Key, TableName } = Template.get({ id: templateId }).params() as { Key: Record<string, string>; TableName: string };
  await docClient.send(
    new UpdateCommand({
      TableName,
      Key,
      UpdateExpression: archivedAt ? "SET #p = :p, #a = :a" : "SET #p = :p REMOVE #a",
      ConditionExpression: "attribute_exists(#pk)",
      ExpressionAttributeNames: { "#p": "isPublished", "#a": "planArchivedAt", "#pk": "pk" },
      ExpressionAttributeValues: archivedAt ? { ":p": published, ":a": archivedAt } : { ":p": published },
    }),
  ).catch((err: { name?: string }) => {
    if (err?.name !== "ConditionalCheckFailedException") throw err; // page deleted meanwhile
  });
}

export async function setDomainPlanDisabled(ref: { templateId: string; id: string }, disabledAt: string | null): Promise<void> {
  const patch = PublishedDomain.patch(ref);
  await (disabledAt ? patch.set({ planDisabledAt: disabledAt }) : patch.remove(["planDisabledAt"])).go().catch((err: { name?: string }) => {
    if (err?.name !== "ConditionalCheckFailedException") throw err; // address removed meanwhile
  });
}

/** Runs writes a few at a time — a large account can have hundreds of pages. */
export async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}
