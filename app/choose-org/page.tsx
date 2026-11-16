import { redirect } from "next/navigation";

import { auth } from "@/server/authDynamo";
import { Member, Organization } from "@/lib/db/coreEntities";
import { AuthShell } from "@/app/auth/_kit/AuthShell";
import { PageHead } from "@/app/auth/_kit/ui";
import { ChooseOrgClient } from "./choose-org-client";

export default async function ChooseOrgPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/auth/login");
  }

  const { data: rawMemberships } = await Member.query.byUser({ userId: session.user.id }).go();
  const memberships = await Promise.all(
    rawMemberships.map(async (m) => {
      const { data: org } = await Organization.get({ id: m.organizationId }).go();
      return { organizationId: m.organizationId, role: m.role, organization: { id: m.organizationId, name: org?.name ?? "Unknown" } };
    }),
  );

  // Nothing to choose between — send them straight through (server/orgDynamo.ts's
  // ensureActiveOrganization handles the 0-or-1 cases when the dashboard layout runs next).
  if (memberships.length < 2) {
    redirect("/dashboard");
  }

  return (
    <AuthShell layout="center">
      <PageHead title="Choose a workspace">You’re a member of more than one. Pick the one you want to open.</PageHead>
      <ChooseOrgClient
        organizations={memberships.map((m) => ({
          id: m.organizationId,
          name: m.organization.name,
          role: m.role,
        }))}
      />
    </AuthShell>
  );
}
