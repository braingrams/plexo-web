import { TemplateKind } from "@prisma/client";
import { prisma } from "@/server/prisma";

/**
 * Whether an org already has another template with this exact name (case-insensitive)
 * among the given siblings — same parentId (null for a root site/email) and kind, so
 * "About" can still exist once under two different sites without colliding, but two
 * root-level sites/emails (or two sub-pages under the same parent) can't silently share a
 * name. Internal layout-fragment templates (isBlogLayout/isSiteLayoutFragment/
 * isCommerceLayout) are excluded on both sides — those were never user-named pages,
 * shouldn't block a real name, and finding a stack of confusingly-identical-looking
 * duplicate sites in a real account is exactly what this guards against going forward.
 */
export async function isTemplateNameTaken(params: {
  organizationId: string;
  parentId: string | null;
  kind: TemplateKind;
  name: string;
  excludeId?: string;
}): Promise<boolean> {
  const { organizationId, parentId, kind, name, excludeId } = params;
  const existing = await prisma.template.findFirst({
    where: {
      organizationId,
      parentId,
      kind,
      name: { equals: name, mode: "insensitive" },
      isBlogLayout: false,
      isSiteLayoutFragment: false,
      isCommerceLayout: false,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  return existing !== null;
}

/**
 * For system-derived names (Duplicate's "X copy", a marketplace "Use" clone reusing the
 * listing's exact name) rather than something a person just typed — auto-suffixes instead
 * of rejecting, the same way ensureUniqueSlug does for slugs, so the action a person
 * actually clicked ("Duplicate") doesn't fail just because it collided with its own prior
 * output. Tries `base`, then `base 2`, `base 3`, ... until one's free.
 */
export async function ensureUniqueTemplateName(params: {
  organizationId: string;
  parentId: string | null;
  kind: TemplateKind;
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
