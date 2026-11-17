import { auth } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { effectivePlan } from "@/lib/plan/entitlement";
import { PageContainer } from "../_components/PageContainer";
import { LegacyBridge } from "../_v3/LegacyBridge";
import { NewSiteWizard } from "./NewSiteWizard";

// The dashboard layout has already synced the plan, so this reads the same plan the shell uses.
// The wizard needs it to show the Server app tab only on plans with server apps (Pro and up).
export default async function NewSitePage() {
  const session = await auth();
  const { data: dbUser } = session?.user ? await User.get({ id: session.user.id }).go() : { data: null };
  return (
    <LegacyBridge>
      <PageContainer>
        <NewSiteWizard plan={effectivePlan(dbUser)} />
      </PageContainer>
    </LegacyBridge>
  );
}
