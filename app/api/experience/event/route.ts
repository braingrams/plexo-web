import { NextResponse } from "next/server";
import { auth } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { usesNewShell } from "@/lib/dashboardVersions/state";
import { userExperience } from "@/lib/dashboardV3/profile";
import { modeOf, recordExperienceEvent } from "@/lib/experienceStats";

/**
 * POST { type: "open" | "publish" }: the editor tells us it was opened / the site was published. Which view they are on is
 * worked out here from their account, never taken from the request, and only people on the new dashboard are counted
 * (the old dashboard has no simple view). Always 204: this must never get in the way of editing.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return new NextResponse(null, { status: 204 });
  const body = (await request.json().catch(() => null)) as { type?: unknown } | null;
  if (body?.type !== "open" && body?.type !== "publish") return NextResponse.json({ error: "Unknown event." }, { status: 400 });
  try {
    const { data: user } = await User.get({ id: session.user.id }).go();
    if (user && (await usesNewShell(user))) await recordExperienceEvent({ type: body.type, mode: modeOf(userExperience(user)), userId: user.id });
  } catch {
    /* counting never breaks the editor */
  }
  return new NextResponse(null, { status: 204 });
}
