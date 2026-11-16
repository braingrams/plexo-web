import { redirectIfV3 } from "@/lib/dashboardV3/settingsContext";
import { effectivePlan } from "@/lib/plan/entitlement";
import { redirect } from "next/navigation";

import { auth } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { ClassicVersionCard } from "../_versions/SwitchMenuItems";
import { ProfileClient } from "./profile-client";
import { SettingsShell } from "../_components/SettingsShell";

export default async function ProfilePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await redirectIfV3("profile/page.tsx", "/dashboard/settings", await searchParams);
  const session = await auth();

  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/profile");
  }

  const { data: user } = await User.get({ id: session.user.id }).go();

  if (!user) {
    redirect("/auth/login");
  }

  return (
    <SettingsShell>
      <ProfileClient
        userId={user.id}
        initialName={user.name ?? ""}
        email={user.email ?? ""}
        subscriptionPlan={effectivePlan(user)}
        memberSince={user.createdAt ?? new Date().toISOString()}
        initialHideBranding={user.hideBranding ?? false}
      />
      <ClassicVersionCard />
    </SettingsShell>
  );
}
