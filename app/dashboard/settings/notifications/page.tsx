import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { ensureActiveOrganization } from "@/server/org";

import { SettingsShell } from "../../_components/SettingsShell";
import { PageHeader } from "../../_components/PageHeader";
import { NotificationsSection } from "../NotificationsSection";

export default async function NotificationsPage() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/settings/notifications");
  }

  const orgResolution = await ensureActiveOrganization(requestHeaders, session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  const notificationPreferences = await prisma.notificationPreferences.findUnique({
    where: { organizationId: orgResolution.organizationId },
  });

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
