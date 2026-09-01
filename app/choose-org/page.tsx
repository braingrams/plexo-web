import { redirect } from "next/navigation";

import { auth } from "@/server/authDynamo";
import { Member, Organization } from "@/lib/db/coreEntities";
import { PlexoLogo } from "@/app/plexo-logo";
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
    <main className="min-h-screen bg-[#0b0f19] text-white flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <PlexoLogo size={32} textStyle={{ color: "#ffffff" }} />
        </div>
        <div className="bg-[#0d0f1a] border border-white/10 rounded-2xl p-8 shadow-2xl">
          <h1 className="text-xl font-bold text-center mb-1">Choose an organization</h1>
          <p className="text-sm text-slate-400 text-center mb-6">
            You're a member of more than one workspace. Pick one to continue.
          </p>
          <ChooseOrgClient
            organizations={memberships.map((m) => ({
              id: m.organizationId,
              name: m.organization.name,
              role: m.role,
            }))}
          />
        </div>
      </div>
    </main>
  );
}
