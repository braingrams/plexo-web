import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { ensureActiveOrganization } from "@/server/org";

export interface BlogPageAccess {
  templateId: string;
  templateName: string;
  organizationId: string;
  userId: string;
  role: string;
}

/**
 * Shared by every app/dashboard/templates/[id]/blog/** page — same auth flow as the
 * template editor's own page.tsx (session -> active org -> ownership check), scoped to
 * a root Template ("the site") rather than any Template.
 */
export async function requireBlogSiteAccess(templateId: string, redirectPath: string): Promise<BlogPageAccess> {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session?.user) {
    redirect(`/auth/login?redirectTo=${encodeURIComponent(redirectPath)}`);
  }

  const orgResolution = await ensureActiveOrganization(requestHeaders, session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  const template = await prisma.template.findFirst({
    where: { id: templateId, organizationId: orgResolution.organizationId, parentId: null },
    select: { id: true, name: true },
  });
  if (!template) {
    notFound();
  }

  return {
    templateId: template.id,
    templateName: template.name,
    organizationId: orgResolution.organizationId,
    userId: session.user.id,
    role: orgResolution.role,
  };
}
