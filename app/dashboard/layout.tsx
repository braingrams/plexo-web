import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ThemeProvider } from "next-themes";

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
    // The marketing site's new light/dark toggle (see app/landing-nav.tsx) is a single
    // global next-themes provider at the root layout, so its stored preference would
    // otherwise leak into the dashboard too. The dashboard has no light-mode styling of
    // its own (everything is hardcoded dark hex values in inline styles) — this nested
    // provider forces "dark" for this whole subtree regardless of what a visitor picked
    // on the homepage, which next-themes explicitly supports for exactly this case.
    <ThemeProvider forcedTheme="dark" attribute="class">
      <DashboardShell userName={userName} userEmail={userEmail} initialLayoutMode={initialLayoutMode}>
        {children}
      </DashboardShell>
    </ThemeProvider>
  );
}
