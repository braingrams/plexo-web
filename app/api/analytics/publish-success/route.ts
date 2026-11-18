import { NextRequest, NextResponse } from "next/server";
import { resolveUser } from "@/lib/auth/resolveUser";
import { User } from "@/lib/db/coreEntities";
import { ProjectBuild } from "@/lib/db/projectEntities";

/** POST /api/analytics/publish-success { appId, buildId } → { isFirst, minutesSinceSignup? }
 * Confirms a finished release build of the app belongs to the caller, then records the account's
 * first publish once. The client only sends ids; the server decides whether this was the first. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { appId?: unknown; buildId?: unknown } | null;
  if (typeof body?.appId !== "string" || typeof body?.buildId !== "string") {
    return NextResponse.json({ error: "appId and buildId are required." }, { status: 400 });
  }

  const { data: build } = await ProjectBuild.get({ id: body.buildId }).go();
  const confirmed =
    build &&
    build.organizationId === resolved.organizationId &&
    build.templateId === body.appId &&
    build.mode === "release" &&
    build.status === "SUCCEEDED";
  if (!confirmed) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const { data: user } = await User.get({ id: resolved.userId }).go({ attributes: ["id", "createdAt"] });
  if (!user) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const now = new Date().toISOString();
  try {
    // Conditional write: only the first publish sets firstPublishedAt. Any later call fails the condition.
    await User.patch({ id: user.id })
      .set({ firstPublishedAt: now })
      .where(({ firstPublishedAt }, { notExists }) => notExists(firstPublishedAt))
      .go();
  } catch {
    // Already set (a later publish), or a write failed. Either way this isn't a first publish we can record.
    return NextResponse.json({ isFirst: false });
  }
  const minutesSinceSignup = Math.max(0, Math.round((Date.parse(now) - Date.parse(user.createdAt ?? now)) / 60_000));
  return NextResponse.json({ isFirst: true, minutesSinceSignup });
}
