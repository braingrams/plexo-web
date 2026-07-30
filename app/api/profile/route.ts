import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { getTierFeatures } from "@/lib/subscription";

export async function PATCH(request: Request): Promise<NextResponse> {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    name?: string;
    layoutMode?: string;
    manageLandingPagePublishing?: boolean;
    hideBranding?: boolean;
    pendingPlan?: null;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const data: {
    name?: string;
    layoutMode?: "CLASSIC" | "MODERN";
    manageLandingPagePublishing?: boolean;
    hideBranding?: boolean;
    pendingPlan?: null;
  } = {};

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

  if (body.manageLandingPagePublishing !== undefined) {
    if (typeof body.manageLandingPagePublishing !== "boolean") {
      return NextResponse.json({ error: "Invalid value for manageLandingPagePublishing." }, { status: 400 });
    }
    // Server-side Ultra gate — reject with a clear error rather than silently storing a
    // value that resolveManageLandingPagePublishing() would collapse to false everywhere else.
    if (body.manageLandingPagePublishing === true) {
      const currentUser = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { subscriptionPlan: true },
      });
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
      const currentUser = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { subscriptionPlan: true },
      });
      if (!getTierFeatures(currentUser?.subscriptionPlan).brandingRemovalEnabled) {
        return NextResponse.json({ error: "This feature requires the Pro or Ultra plan." }, { status: 403 });
      }
    }
    data.hideBranding = body.hideBranding;
  }

  if (body.pendingPlan !== undefined) {
    // Only ever accepted as null — clearing "I picked a paid plan at signup" so the user can
    // continue on Free instead (see app/auth/complete-subscription). Setting it only ever
    // happens atomically at signup via server/auth.ts's databaseHooks, never through this route.
    if (body.pendingPlan !== null) {
      return NextResponse.json({ error: "Invalid value for pendingPlan." }, { status: 400 });
    }
    data.pendingPlan = null;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No changes to update." }, { status: 400 });
  }

  try {
    const updatedUser = await prisma.user.update({
      where: { id: session.user.id },
      data,
      select: { id: true, name: true, email: true, layoutMode: true, manageLandingPagePublishing: true, hideBranding: true },
    });

    return NextResponse.json({ user: updatedUser });
  } catch {
    return NextResponse.json({ error: "Unable to update profile." }, { status: 500 });
  }
}
