import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { DashboardShell } from "./dashboard-shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (!session?.user) {
    redirect("/auth/login");
  }

  const userName = session.user.name ?? session.user.email?.split("@")[0] ?? "User";
  const userEmail = session.user.email ?? "";

  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { layoutMode: true },
  });
  const initialLayoutMode = dbUser?.layoutMode ?? "MODERN";

  return (
    <DashboardShell userName={userName} userEmail={userEmail} initialLayoutMode={initialLayoutMode}>
      {children}
    </DashboardShell>
  );
}
