import { redirect } from "next/navigation";
import { getV3SettingsContext } from "@/lib/dashboardV3/settingsContext";
import { SettingsPage } from "../../_v3/settings/SettingsPage";
import { SettingsPageShell } from "../../_v3/settings/bits";

import { auth } from "@/server/authDynamo";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { EmailLog } from "@/lib/db/opsEntities";
import { PageHeader } from "@/app/dashboard/_components/PageHeader";
import { SettingsShell } from "@/app/dashboard/_components/SettingsShell";
import { EmailLogClient } from "./EmailLogClient";

// Last 100, newest first — a reasonable page size for a support/debugging view, same
// "recent N, not the whole history" bound as e.g. form-submissions and testimonials.
const PAGE_SIZE = 100;

export default async function EmailLogPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/settings/email-log");
  }

  const v3 = await getV3SettingsContext("/dashboard/settings/email-log");
  const orgResolution = await ensureActiveOrganization(session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  // byOrg (GSI1) — see lib/db/opsEntities.ts's EmailLog.byOrg. Only rows with an
  // organizationId show up here by design: some sends (e.g. account-security emails sent
  // before a user has an org) never had one to begin with.
  const { data: logs } = await EmailLog.query
    .byOrg({ organizationId: orgResolution.organizationId })
    .go({ order: "desc", limit: PAGE_SIZE });

  const rows = logs.map((l) => ({
    id: l.id,
    to: l.to,
    subject: l.subject,
    context: l.context,
    status: l.status,
    errorMessage: l.errorMessage,
    createdAt: l.createdAt ?? "",
  }));

  if (v3) {
    return (
      <SettingsPage current="developers" experience={v3.experience}>
        <SettingsPageShell title="Emails we sent for you" purpose={`The last ${logs.length} email${logs.length === 1 ? "" : "s"} Plexo sent for ${orgResolution.organizationName}, such as sign-in links and order notices.`}>
          <EmailLogClient logs={rows} />
        </SettingsPageShell>
      </SettingsPage>
    );
  }

  return (
    <SettingsShell>
      <PageHeader
        eyebrow="Organization"
        title="Email Log"
        subtitle={`The last ${logs.length} transactional/notification email(s) sent on behalf of ${orgResolution.organizationName}.`}
      />
      <EmailLogClient
        logs={rows}
      />
    </SettingsShell>
  );
}
