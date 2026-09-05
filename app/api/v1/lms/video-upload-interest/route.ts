import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { User } from "@/lib/db/coreEntities";
import { FeatureWaitlist } from "@/lib/db/contentEntities";

const FEATURE = "lms_video_upload";

function isConditionalCheckFailure(err: unknown): boolean {
  const anyErr = err as { name?: string; cause?: { name?: string } };
  return anyErr?.name === "ConditionalCheckFailedException" || anyErr?.cause?.name === "ConditionalCheckFailedException";
}

/**
 * POST /api/v1/lms/video-upload-interest
 *
 * Fired when a funnel admin clicks "Notify me" on the page builder's coming-soon "Upload
 * video" option. Raw video upload/hosting is deliberately not built yet (real cost —
 * storage + egress that scales with watch-hours, likely transcoding — needs its own
 * considered design, see the Funnel/LMS plan). This just captures who wants it so
 * plexo-admin can see real demand before that design work starts. Idempotent: clicking
 * twice is a no-op, not a duplicate row.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { templateId?: string };

  const { data: user } = await User.get({ id: resolved.userId }).go();
  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  try {
    await FeatureWaitlist.create({
      id: randomUUID(),
      feature: FEATURE,
      userId: resolved.userId,
      userEmail: user.email,
      userName: user.name ?? undefined,
      organizationId: resolved.organizationId,
      templateId: body.templateId?.trim() || undefined,
    }).go();
  } catch (err) {
    if (!isConditionalCheckFailure(err)) throw err; // already on the list — fine
  }

  return NextResponse.json({ success: true });
}
