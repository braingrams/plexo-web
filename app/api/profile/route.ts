import { NextResponse } from "next/server";

import { auth } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { getTierFeatures } from "@/lib/subscription";
import { effectivePlan } from "@/lib/plan/entitlement";
import { parseExperience, type Experience } from "@/lib/dashboardV3/nav";
import { sanitizeBuildProfile } from "@/lib/dashboardV3/profile";
import { parseThemePreference, type ThemePreference } from "@/lib/dashboardV3/theme";
import { sanitizeTourState, type TourState } from "@/lib/dashboardV3/tour";
import { CURRENT_ONBOARDING_VERSION } from "@/lib/dashboardV3/flag";
import type { SolBuildProfile } from "@/lib/ai/solBuildContext";

export async function PATCH(request: Request): Promise<NextResponse> {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    name?: string;
    image?: string | null;
    layoutMode?: string;
    preferredSurface?: string;
    manageLandingPagePublishing?: boolean;
    hideBranding?: boolean;
    pendingPlan?: null;
    funnelBuilderLevel?: string;
    // v3 dashboard (lib/dashboardV3)
    experience?: string;
    buildProfile?: unknown;
    themePreference?: string;
    tourState?: unknown;
    /** true = onboarding finished (sets onboardingVersion to the current version). */
    onboardingComplete?: boolean;
    /** true = "Continue later" on onboarding. */
    deferOnboarding?: boolean;
    /** Staff only: turn the v3 dashboard on/off for this account (null = follow the env flag). */
    dashboardV3?: boolean | null;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const data: {
    name?: string;
    image?: string;
    layoutMode?: "CLASSIC" | "MODERN";
    preferredSurface?: "DASHBOARD" | "SOL";
    manageLandingPagePublishing?: boolean;
    hideBranding?: boolean;
    funnelBuilderLevel?: "BEGINNER" | "INTERMEDIATE" | "PROFESSIONAL";
    experience?: Experience;
    buildProfile?: SolBuildProfile;
    themePreference?: ThemePreference;
    tourState?: TourState;
    onboardingVersion?: number;
    onboardingDeferredAt?: string;
    dashboardV3?: boolean;
  } = {};
  let clearPendingPlan = false;
  let clearDashboardV3 = false;
  let clearImage = false;

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name || name.length < 1) {
      return NextResponse.json({ error: "Display name cannot be empty." }, { status: 400 });
    }
    if (name.length > 100) {
      return NextResponse.json({ error: "Display name is too long (max 100 characters)." }, { status: 400 });
    }
    data.name = name;
  }

  if (body.image !== undefined) {
    // Their profile photo: an uploaded picture (https link), or null to go back to their initials.
    if (body.image !== null && (typeof body.image !== "string" || !/^https:\/\//i.test(body.image) || body.image.length > 1000)) {
      return NextResponse.json({ error: "We couldn't use that photo. Please upload it again." }, { status: 400 });
    }
    if (body.image === null) clearImage = true;
    else data.image = body.image;
  }

  if (body.layoutMode !== undefined) {
    if (body.layoutMode !== "CLASSIC" && body.layoutMode !== "MODERN") {
      return NextResponse.json({ error: "Invalid layout mode." }, { status: 400 });
    }
    data.layoutMode = body.layoutMode;
  }

  if (body.preferredSurface !== undefined) {
    if (body.preferredSurface !== "DASHBOARD" && body.preferredSurface !== "SOL") {
      return NextResponse.json({ error: "Invalid preferred surface." }, { status: 400 });
    }
    data.preferredSurface = body.preferredSurface;
  }

  if (body.manageLandingPagePublishing !== undefined) {
    if (typeof body.manageLandingPagePublishing !== "boolean") {
      return NextResponse.json({ error: "Invalid value for manageLandingPagePublishing." }, { status: 400 });
    }
    // Server-side plan gate (Pro and above) — reject with a clear error rather than silently storing a
    // value that resolveManageLandingPagePublishing() would collapse to false everywhere else.
    if (body.manageLandingPagePublishing === true) {
      const { data: currentUser } = await User.get({ id: session.user.id }).go();
      if (!getTierFeatures(effectivePlan(currentUser)).manageLandingPagePublishingEnabled) {
        return NextResponse.json({ error: "This is part of the Pro plan." }, { status: 403 });
      }
    }
    data.manageLandingPagePublishing = body.manageLandingPagePublishing;
  }

  if (body.hideBranding !== undefined) {
    if (typeof body.hideBranding !== "boolean") {
      return NextResponse.json({ error: "Invalid value for hideBranding." }, { status: 400 });
    }
    // Server-side plan gate (Starter and above), same defense-in-depth as manageLandingPagePublishing above —
    // resolveHideBranding() would collapse a FREE account's true back to false everywhere else
    // anyway, but rejecting here gives a clearer error instead of a silently-ignored save.
    if (body.hideBranding === true) {
      const { data: currentUser } = await User.get({ id: session.user.id }).go();
      if (!getTierFeatures(effectivePlan(currentUser)).brandingRemovalEnabled) {
        return NextResponse.json({ error: "Removing the Plexo badge comes with the Starter plan and above." }, { status: 403 });
      }
    }
    data.hideBranding = body.hideBranding;
  }

  if (body.funnelBuilderLevel !== undefined) {
    if (body.funnelBuilderLevel !== "BEGINNER" && body.funnelBuilderLevel !== "INTERMEDIATE" && body.funnelBuilderLevel !== "PROFESSIONAL") {
      return NextResponse.json({ error: "Invalid value for funnelBuilderLevel." }, { status: 400 });
    }
    data.funnelBuilderLevel = body.funnelBuilderLevel;
  }

  if (body.experience !== undefined) {
    const experience = parseExperience(body.experience);
    if (!experience) return NextResponse.json({ error: "Please choose guided, in-between or pro view." }, { status: 400 });
    data.experience = experience;
  }

  if (body.buildProfile !== undefined) {
    const result = sanitizeBuildProfile(body.buildProfile);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    data.buildProfile = result.value;
    // The onboarding's experience answer is also the dashboard's view, unless they pick one explicitly.
    if (result.value.experience && data.experience === undefined) data.experience = result.value.experience;
  }

  if (body.themePreference !== undefined) {
    const theme = parseThemePreference(body.themePreference);
    if (!theme) return NextResponse.json({ error: "Please choose Light, Dark or System." }, { status: 400 });
    data.themePreference = theme;
  }

  if (body.tourState !== undefined) {
    const tour = sanitizeTourState(body.tourState);
    if (!tour) return NextResponse.json({ error: "We couldn't save where you are in the tour." }, { status: 400 });
    data.tourState = tour;
  }

  if (body.onboardingComplete !== undefined) {
    if (body.onboardingComplete !== true) return NextResponse.json({ error: "Invalid value for onboardingComplete." }, { status: 400 });
    data.onboardingVersion = CURRENT_ONBOARDING_VERSION;
  }

  if (body.deferOnboarding !== undefined) {
    if (body.deferOnboarding !== true) return NextResponse.json({ error: "Invalid value for deferOnboarding." }, { status: 400 });
    data.onboardingDeferredAt = new Date().toISOString();
  }

  if (body.dashboardV3 !== undefined) {
    if (body.dashboardV3 !== null && typeof body.dashboardV3 !== "boolean") {
      return NextResponse.json({ error: "Invalid value for dashboardV3." }, { status: 400 });
    }
    // Pre-launch testing switch: staff only (customers get v3 at launch, via the env flag).
    const { data: currentUser } = await User.get({ id: session.user.id }).go();
    if (!currentUser?.adminRole) return NextResponse.json({ error: "Version 2 isn't available yet." }, { status: 403 });
    if (body.dashboardV3 === null) clearDashboardV3 = true;
    else data.dashboardV3 = body.dashboardV3;
  }

  if (body.pendingPlan !== undefined) {
    // Only ever accepted as null — clearing "I picked a paid plan at signup" so the user can
    // continue on Free instead (see app/auth/complete-subscription). Setting it only ever
    // happens atomically at signup via server/auth.ts's databaseHooks, never through this route.
    if (body.pendingPlan !== null) {
      return NextResponse.json({ error: "Invalid value for pendingPlan." }, { status: 400 });
    }
    clearPendingPlan = true;
  }

  if (Object.keys(data).length === 0 && !clearPendingPlan && !clearDashboardV3 && !clearImage) {
    return NextResponse.json({ error: "No changes to update." }, { status: 400 });
  }

  try {
    const remove: ("pendingPlan" | "dashboardV3" | "image")[] = [];
    if (clearPendingPlan) remove.push("pendingPlan");
    if (clearDashboardV3) remove.push("dashboardV3");
    if (clearImage) remove.push("image");
    let patch = User.patch({ id: session.user.id }).set(data);
    if (remove.length) patch = patch.remove(remove);
    await patch.go();
    const { data: updatedUser } = await User.get({ id: session.user.id }).go();

    return NextResponse.json({ user: updatedUser });
  } catch {
    return NextResponse.json({ error: "Unable to update profile." }, { status: 500 });
  }
}
