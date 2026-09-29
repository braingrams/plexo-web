import { NextResponse } from "next/server";

import { auth } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { getTierFeatures } from "@/lib/subscription";

export async function PATCH(request: Request): Promise<NextResponse> {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    name?: string;
    layoutMode?: string;
    preferredSurface?: string;
    manageLandingPagePublishing?: boolean;
    hideBranding?: boolean;
    pendingPlan?: null;
    funnelBuilderLevel?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const data: {
    name?: string;
    layoutMode?: "CLASSIC" | "MODERN";
    preferredSurface?: "DASHBOARD" | "SOL";
    manageLandingPagePublishing?: boolean;
    hideBranding?: boolean;
    funnelBuilderLevel?: "BEGINNER" | "INTERMEDIATE" | "PROFESSIONAL";
  } = {};
  let clearPendingPlan = false;

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
    // Server-side Ultra gate — reject with a clear error rather than silently storing a
    // value that resolveManageLandingPagePublishing() would collapse to false everywhere else.
    if (body.manageLandingPagePublishing === true) {
      const { data: currentUser } = await User.get({ id: session.user.id }).go();
      if (currentUser?.subscriptionPlan !== "ULTRA") {
        return NextResponse.json({ error: "This feature requires the Ultra plan." }, { status: 403 });
      }
    }
    data.manageLandingPagePublishing = body.manageLandingPagePublishing;
  }

  if (body.hideBranding !== undefined) {
    if (typeof body.hideBranding !== "boolean") {
      return NextResponse.json({ error: "Invalid value for hideBranding." }, { status: 400 });
    }
    // Server-side Pro/Ultra gate, same defense-in-depth as manageLandingPagePublishing above —
    // resolveHideBranding() would collapse a FREE account's true back to false everywhere else
    // anyway, but rejecting here gives a clearer error instead of a silently-ignored save.
    if (body.hideBranding === true) {
      const { data: currentUser } = await User.get({ id: session.user.id }).go();
      if (!getTierFeatures(currentUser?.subscriptionPlan).brandingRemovalEnabled) {
        return NextResponse.json({ error: "This feature requires the Pro or Ultra plan." }, { status: 403 });
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

  if (body.pendingPlan !== undefined) {
    // Only ever accepted as null — clearing "I picked a paid plan at signup" so the user can
    // continue on Free instead (see app/auth/complete-subscription). Setting it only ever
    // happens atomically at signup via server/auth.ts's databaseHooks, never through this route.
    if (body.pendingPlan !== null) {
      return NextResponse.json({ error: "Invalid value for pendingPlan." }, { status: 400 });
    }
    clearPendingPlan = true;
  }

  if (Object.keys(data).length === 0 && !clearPendingPlan) {
    return NextResponse.json({ error: "No changes to update." }, { status: 400 });
  }

  try {
    let patch = User.patch({ id: session.user.id }).set(data);
    if (clearPendingPlan) patch = patch.remove(["pendingPlan"]);
    await patch.go();
    const { data: updatedUser } = await User.get({ id: session.user.id }).go();

    return NextResponse.json({ user: updatedUser });
  } catch {
    return NextResponse.json({ error: "Unable to update profile." }, { status: 500 });
  }
}
