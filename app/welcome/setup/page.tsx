import { redirect } from "next/navigation";
import { auth } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { CURRENT_ONBOARDING_VERSION } from "@/lib/dashboardV3/flag";
import { usesNewShell } from "@/lib/dashboardVersions/state";
import { loadV3Sites, readThemePreference } from "@/lib/dashboardV3/loadShell";
import { readBuildProfile } from "@/lib/dashboardV3/profile";
import { V3Root } from "@/app/dashboard/_v3/V3Root";
import { Wizard } from "./Wizard";

export const metadata = { title: "Set up your site" };

/**
 * The one-time setup (docs/redesign/SPEC.md "Onboarding"): five steps, for new and existing
 * owners. Answers are saved as they go, so coming back resumes. Finished (version 3) owners go
 * straight to the dashboard; "Continue later" owners can come back here from Home.
 */
export default async function WelcomeSetupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const again = (await searchParams).again === "1";
  const session = await auth();
  if (!session?.user) redirect("/auth/login");
  const { data: user } = await User.get({ id: session.user.id }).go();
  if (!user || !(await usesNewShell(user))) redirect("/dashboard");
  // Settings → "Personalise again" comes back here with ?again=1.
  if (!again && (user.onboardingVersion ?? 0) >= CURRENT_ONBOARDING_VERSION) redirect("/dashboard");
  const theme = await readThemePreference(user.themePreference);
  const org = await ensureActiveOrganization(user.id).catch(() => null);
  const organizationId = org?.status === "resolved" ? org.organizationId : null;
  const sites = organizationId ? await loadV3Sites(organizationId, user.id).catch(() => []) : [];
  return (
    <V3Root themePreference={theme}>
      <Wizard userId={user.id} initialProfile={readBuildProfile(user.buildProfile)} hasSites={sites.length > 0} />
    </V3Root>
  );
}
