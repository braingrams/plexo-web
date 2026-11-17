import { redirect } from "next/navigation";
import { auth } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { effectivePlan } from "@/lib/plan/entitlement";
import { usesNewShell } from "@/lib/dashboardVersions/state";
import { newSiteRedirect } from "@/lib/dashboardV3/newSite";
import { PageContainer } from "../_components/PageContainer";
import { LegacyBridge } from "../_v3/LegacyBridge";
import { NewSiteWizard } from "./NewSiteWizard";

// The dashboard layout has already synced the plan, so this reads the same plan the shell uses.
// The wizard needs it to show the Server app tab only on plans with server apps (Pro and up).
// New-dashboard users go to the new "Make a new website" flow; ?classic=1 keeps this page.
export default async function NewSitePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth();
  const { data: dbUser } = session?.user ? await User.get({ id: session.user.id }).go() : { data: null };
  const to = newSiteRedirect({ newDashboard: await usesNewShell(dbUser), classic: (await searchParams).classic });
  if (to) redirect(to);
  return (
    <LegacyBridge>
      <PageContainer>
        <NewSiteWizard plan={effectivePlan(dbUser)} />
      </PageContainer>
    </LegacyBridge>
  );
}
