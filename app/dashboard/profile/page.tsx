import { redirect } from "next/navigation";

import { auth } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { ProfileClient } from "./profile-client";
import { SettingsShell } from "../_components/SettingsShell";

export default async function ProfilePage() {
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
        subscriptionPlan={user.subscriptionPlan ?? "FREE"}
        memberSince={user.createdAt ?? new Date().toISOString()}
        initialHideBranding={user.hideBranding ?? false}
      />
    </SettingsShell>
  );
}
