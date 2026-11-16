import { redirect } from "next/navigation";
import { ThemeProvider } from "next-themes";

import { auth } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { ensureActiveOrganization, getOrgBrandDynamo, getOrganizationOwnerEntitlementDynamo } from "@/server/orgDynamo";
import { DashboardShell } from "./dashboard-shell";
import { MigrationBanner } from "./migrate/wordpress/MigrationBanner";
import { PlanBanner, type PlanBannerState } from "./_components/PlanBanner";
import { CountryPrompt } from "@/app/_components/country/CountryPrompt";
import { AppLiveDialog } from "./_components/AppLiveDialog";
import { FeedbackNudge } from "./_components/FeedbackNudge";
import { TRIAL_DAYS, accessDaysLeft, canStartTrial, effectivePlan, paidAccess, planSyncAction, storedPlan } from "@/lib/plan/entitlement";
import { syncPlanLifecycle } from "@/lib/plan/lifecycle";
import { getDashboardVersionState } from "@/lib/dashboardVersions/state";
import { VersionProvider } from "./_versions/VersionUi";
import { V3DashboardLayout } from "./_v3/V3DashboardLayout";

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

  let { data: dbUser } = await User.get({ id: session.user.id }).go();
  // The owner sees their plan's real state the moment they arrive: a lapsed trial is
  // downgraded, and an account that paid again (or an admin switched back on) gets every
  // page, site and custom domain back — before anything below renders.
  if (dbUser && planSyncAction(dbUser)) {
    await syncPlanLifecycle(dbUser.id).catch((err) => console.error("plan lifecycle (dashboard):", err));
    dbUser = (await User.get({ id: session.user.id }).go()).data ?? dbUser;
  }
  const initialLayoutMode = dbUser?.layoutMode ?? "CLASSIC";
  const planBanner = dbUser ? planBannerState(dbUser) : null;

  // Org-scoped login: makes sure this session always has an active organization before
  // rendering the dashboard shell (auto-picks a single membership, restores/creates one
  // for a brand-new user, or routes to a chooser for someone in several orgs).
  const orgResolution = await ensureActiveOrganization(session.user.id);
  if (orgResolution.status === "needs-choice") {
    redirect("/choose-org");
  }

  // The workspace's plan (its owner's — a teammate gets the same options as the owner) decides
  // which creation options are usable (the Server app tab needs Pro or above).
  const [orgBranding, workspace] = await Promise.all([
    getOrgBrandDynamo(orgResolution.organizationId),
    getOrganizationOwnerEntitlementDynamo(orgResolution.organizationId),
  ]);
  const plan = workspace.subscriptionPlan;

  // Which dashboard this person sees (docs/DASHBOARD_VERSIONS.md): admin-controlled rollout,
  // resolved once per request. A version with no shell of its own renders the classic one.
  const version = dbUser ? await getDashboardVersionState(dbUser) : null;
  const versionUi = version ? { currentLabel: version.label, targets: version.targets, offer: version.offer } : { currentLabel: "", targets: [], offer: null };
  if (dbUser && version?.shell === "v3") {
    return (
      <V3DashboardLayout
        versions={versionUi}
        user={{ ...dbUser, name: userName, email: userEmail, image: dbUser.image ?? session.user.image ?? null }}
        organizationId={orgResolution.organizationId}
        orgBranding={orgBranding}
        plan={plan}
      >
        <MigrationBanner />
        {planBanner ? <PlanBanner state={planBanner} /> : null}
        {children}
        <AppLiveDialog />
      </V3DashboardLayout>
    );
  }

  return (
    // The marketing site's new light/dark toggle (see app/landing-nav.tsx) is a single
    // global next-themes provider at the root layout, so its stored preference would
    // otherwise leak into the dashboard too. The dashboard has no light-mode styling of
    // its own (everything is hardcoded dark hex values in inline styles) — this nested
    // provider forces "dark" for this whole subtree regardless of what a visitor picked
    // on the homepage, which next-themes explicitly supports for exactly this case.
    <ThemeProvider forcedTheme="dark" attribute="class">
      <VersionProvider data={versionUi}>
      <DashboardShell
        userName={userName}
        userEmail={userEmail}
        initialLayoutMode={initialLayoutMode}
        organizationName={orgResolution.organizationName}
        orgBranding={orgBranding}
        plan={plan}
      >
        {/* A WordPress site moving in the background: progress on every page, not just the migration tab. */}
        <MigrationBanner />
        {planBanner ? <PlanBanner state={planBanner} /> : null}
        {children}
        {/* "Your app is live", opened from any page once a server app goes live. */}
        <AppLiveDialog />
        <FeedbackNudge userId={session.user.id} />
        {/* One question for owners who haven't set their country yet (prices follow it). */}
        <CountryPrompt />
      </DashboardShell>
      </VersionProvider>
    </ThemeProvider>
  );
}

function planBannerState(user: Parameters<typeof paidAccess>[0] & { planDowngradedAt?: string | null; planBeforeDowngrade?: string | null; planDowngradeReason?: string | null; trialStartedAt?: string | null }): PlanBannerState | null {
  const plan = effectivePlan(user);
  if (plan !== "FREE") {
    const access = paidAccess(user);
    const daysLeft = accessDaysLeft(user);
    if (access.entitled && (access.basis === "TRIAL" || access.basis === "GRANT") && daysLeft !== null) {
      return access.basis === "TRIAL" ? { kind: "trial", plan, daysLeft, trialDays: TRIAL_DAYS } : { kind: "grant", plan, daysLeft };
    }
    if (access.entitled && access.basis === "SUBSCRIPTION" && user.subscriptionStatus === "PAST_DUE") return { kind: "past_due", plan };
    return null;
  }
  if (user.planDowngradedAt) {
    const before = storedPlan({ subscriptionPlan: user.planBeforeDowngrade, planVersion: user.planVersion });
    return { kind: "downgraded", previousPlan: before === "FREE" ? "STARTER" : before, since: user.planDowngradedAt, reason: user.planDowngradeReason ?? null, trialAvailable: canStartTrial(user) };
  }
  return null;
}
