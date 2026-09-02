import { redirect } from "next/navigation";
import { ThemeProvider } from "next-themes";

import { auth } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { ensureActiveOrganization, getOrgBrandDynamo } from "@/server/orgDynamo";
import { DashboardShell } from "./dashboard-shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/auth/login");
  }

  const userName = session.user.name ?? session.user.email?.split("@")[0] ?? "User";
  const userEmail = session.user.email ?? "";

  const { data: dbUser } = await User.get({ id: session.user.id }).go();
  const initialLayoutMode = dbUser?.layoutMode ?? "MODERN";

  // Org-scoped login: makes sure this session always has an active organization before
  // rendering the dashboard shell (auto-picks a single membership, restores/creates one
  // for a brand-new user, or routes to a chooser for someone in several orgs).
  const orgResolution = await ensureActiveOrganization(session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  const orgBranding = await getOrgBrandDynamo(orgResolution.organizationId);

  return (
    // The marketing site's new light/dark toggle (see app/landing-nav.tsx) is a single
    // global next-themes provider at the root layout, so its stored preference would
    // otherwise leak into the dashboard too. The dashboard has no light-mode styling of
    // its own (everything is hardcoded dark hex values in inline styles) — this nested
    // provider forces "dark" for this whole subtree regardless of what a visitor picked
    // on the homepage, which next-themes explicitly supports for exactly this case.
    <ThemeProvider forcedTheme="dark" attribute="class">
      <DashboardShell
        userName={userName}
        userEmail={userEmail}
        initialLayoutMode={initialLayoutMode}
        organizationName={orgResolution.organizationName}
        orgBranding={orgBranding}
      >
        {children}
      </DashboardShell>
    </ThemeProvider>
  );
}
