import { redirect } from "next/navigation";

import { auth } from "@/server/authDynamo";
import { NotificationPreferences } from "@/lib/db/coreEntities";
import { ensureActiveOrganization } from "@/server/orgDynamo";

import { SettingsShell } from "../../_components/SettingsShell";
import { PageHeader } from "../../_components/PageHeader";
import { NotificationsSection } from "../NotificationsSection";

export default async function NotificationsPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/settings/notifications");
  }

  const orgResolution = await ensureActiveOrganization(session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  const { data: notificationPreferences } = await NotificationPreferences.get({
    organizationId: orgResolution.organizationId,
  }).go();

  return (
    <SettingsShell>
      <PageHeader eyebrow="Account" title="Notifications" subtitle="Which activity across your sites emails you, and where." />
      <NotificationsSection
        initial={{
          formSubmissions: notificationPreferences?.formSubmissions ?? false,
          blogComments: notificationPreferences?.blogComments ?? true,
          payments: notificationPreferences?.payments ?? true,
          commentMentions: notificationPreferences?.commentMentions ?? true,
          notificationEmail: notificationPreferences?.notificationEmail ?? null,
        }}
      />
    </SettingsShell>
  );
}
