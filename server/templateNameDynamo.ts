import { Template } from "@/lib/db/contentEntities";

// DynamoDB-stack port of server/templateName.ts — same rationale (see that file's
// comments). No index serves "same org+parent+kind+name" directly (Template's two GSIs
// are spent on org-listing and page-tree traversal, see contentEntities.ts's own
// comment), so this queries the parent's children (byParent, small in practice — same
// bounded-fanout assumption server/slugDynamo.ts's ensureUniqueSlug makes) and filters in
// memory. A root-level template (parentId null) has no parent to scope a byParent query
// by, so it falls back to byOrg and filters to parentId-less templates there instead.
export async function isTemplateNameTaken(params: {
  organizationId: string;
  parentId: string | null;
  kind: "EMAIL" | "LANDING_PAGE";
  name: string;
  excludeId?: string;
}): Promise<boolean> {
  const { organizationId, parentId, kind, name, excludeId } = params;
  const normalized = name.toLowerCase();

  const candidates = parentId
    ? (await Template.query.byParent({ parentId }).go()).data
    : (await Template.query.byOrg({ organizationId }).go()).data.filter((t) => !t.parentId);

  return candidates.some(
    (t) =>
      t.organizationId === organizationId &&
      t.kind === kind &&
      t.name.toLowerCase() === normalized &&
      !t.isBlogLayout &&
      !t.isSiteLayoutFragment &&
      !t.isCommerceLayout &&
      t.id !== excludeId,
  );
}

export async function ensureUniqueTemplateName(params: {
  organizationId: string;
  parentId: string | null;
  kind: "EMAIL" | "LANDING_PAGE";
  base: string;
}): Promise<string> {
  const { organizationId, parentId, kind, base } = params;
  let candidate = base;
  let suffix = 2;
  while (await isTemplateNameTaken({ organizationId, parentId, kind, name: candidate })) {
    candidate = `${base} ${suffix}`;
    suffix += 1;
  }
  return candidate;
}
