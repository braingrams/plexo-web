import { redirect, notFound } from "next/navigation";
import { auth } from "@/server/authDynamo";
import { Template } from "@/lib/db/contentEntities";
import { User } from "@/lib/db/coreEntities";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import type { OrgRole } from "@/server/accessControl";

export interface BlogPageAccess {
  templateId: string;
  templateName: string;
  organizationId: string;
  userId: string;
  userName: string;
  userEmail: string;
  role: OrgRole;
  subscriptionPlan: string;
}

/**
 * DynamoDB-stack port of lib/blog/pageAuth.ts — same contract (see that file's comment).
 */
export async function requireBlogSiteAccess(
  templateId: string,
  redirectPath: string,
): Promise<BlogPageAccess> {
  const session = await auth();
  if (!session?.user) {
    redirect(`/auth/login?redirectTo=${encodeURIComponent(redirectPath)}`);
  }

  const orgResolution = await ensureActiveOrganization(session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  const { data: template } = await Template.get({ id: templateId }).go();
  if (
    !template ||
    template.organizationId !== orgResolution.organizationId ||
    template.parentId
  ) {
    notFound();
  }

  const { data: user } = await User.get({ id: session.user.id }).go();

  return {
    templateId: template.id,
    templateName: template.name,
    organizationId: orgResolution.organizationId,
    userId: session.user.id,
    userName: session.user.name ?? "",
    userEmail: session.user.email ?? "",
    role: orgResolution.role,
    subscriptionPlan: user?.subscriptionPlan ?? "FREE",
  };
}
