import { NextRequest, NextResponse } from "next/server";
import { resolveCustomContentAdmin } from "@/lib/customContent/adminAuthDynamo";
import { Template } from "@/lib/db/contentEntities";
import { Member } from "@/lib/db/coreEntities";
import { requirePermission } from "@/server/requirePermissionDynamo";
import { requireTemplateScope } from "@/server/requireTemplateScope";
import { siteIdForTemplate } from "./service";

export type SectionAdmin = { siteId: string; organizationId: string; userId: string };

/**
 * Who is asking and which site they mean. Any page of a site works as the `[id]` in the URL — the section types belong to
 * the whole site, so a page's editor doesn't have to know the site's root. Reading needs access to the page; changing
 * needs permission to edit it (same rules as custom content types).
 */
export async function resolveSectionAdmin(request: NextRequest, templateId: string, write: boolean): Promise<{ error: NextResponse } | { admin: SectionAdmin }> {
  const resolved = await resolveCustomContentAdmin(request, templateId);
  if (resolved.error) return { error: resolved.error };
  const { organizationId, userId, role } = resolved.context;
  if (write) {
    const denied = requirePermission(role, { template: ["update"] });
    if (denied) return { error: denied };
    if (role !== null) {
      const { data: member } = await Member.get({ organizationId, userId }).go();
      const scope = requireTemplateScope(member, templateId);
      if (scope) return { error: scope };
    }
  }
  const { data: template } = await Template.get({ id: templateId }).go();
  if (!template) return { error: NextResponse.json({ error: "We couldn't find that page." }, { status: 404 }) };
  return { admin: { siteId: await siteIdForTemplate(template), organizationId, userId } };
}
