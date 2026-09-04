import { NextResponse } from "next/server";
import type { EntityItem } from "electrodb";

import type { Member } from "@/lib/db/coreEntities";

type ScopableMember = Pick<EntityItem<typeof Member>, "role" | "scopedTemplateIds"> | null | undefined;

/**
 * Granular-permissions v1 (enterprise-eval gap: today an `editor` role is always org-wide —
 * there's no way to say "editor on page X only"). This is a second, narrower check that runs
 * AFTER requirePermissionDynamo.ts's own role-level check has already passed — it never
 * substitutes for that check, only tightens it further for one specific case.
 *
 * Scoped down deliberately: only the `editor` role can ever be restricted this way (owner/
 * admin are never scopable in this pass — see accessControl.ts's role ladder and
 * lib/db/coreEntities.ts's Member.scopedTemplateIds doc comment), and only for template
 * (page) mutation routes — domain/billing/apiKey/comment/blog/commerce resources are NOT
 * covered by this v1.
 *
 * `member` is whatever the caller already fetched (Member.get({organizationId, userId})) —
 * this stays pure/sync, no I/O, same convention as requirePermission itself. Pass null/
 * undefined for a caller with no Member row to scope by (e.g. an API-key caller, which
 * requirePermission itself already bypasses entirely via its own role===null check) — that's
 * treated as "nothing to narrow," not as a denial.
 *
 * scopedTemplateIds absent or empty = today's unchanged behavior: an editor with no scope
 * list keeps full org-wide access to every template, exactly like before this field existed.
 */
export function requireTemplateScope(member: ScopableMember, templateId: string): NextResponse | null {
  if (!member) return null;
  if (member.role !== "editor") return null;

  const scopedTemplateIds = member.scopedTemplateIds ?? [];
  if (scopedTemplateIds.length === 0) return null;

  if (!scopedTemplateIds.includes(templateId)) {
    return NextResponse.json({ error: "You don't have access to this specific page." }, { status: 403 });
  }
  return null;
}
