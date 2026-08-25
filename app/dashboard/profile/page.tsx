import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { ProfileClient } from "./profile-client";
import { SettingsShell } from "../_components/SettingsShell";

export default async function ProfilePage() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (!session?.user) {
    redirect("/auth/login?redirectTo=/dashboard/profile");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      subscriptionPlan: true,
      createdAt: true,
    },
  });

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
        memberSince={user.createdAt.toISOString()}
      />
    </SettingsShell>
  );
}
