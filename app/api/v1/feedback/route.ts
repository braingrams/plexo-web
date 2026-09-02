import { NextRequest, NextResponse } from "next/server";

import { User } from "@/lib/db/coreEntities";
import { Feedback } from "@/lib/db/contentEntities";
import { resolveUser } from "@/lib/auth/resolveUser";
import { sendFeedbackNotificationEmail } from "@/lib/email";

/**
 * POST /api/v1/feedback
 *
 * Lets a logged-in user submit product feedback — stored for plexo-admin's Feedback queue
 * and immediately notified to ADMIN_EMAIL (see lib/email.ts's sendFeedbackNotificationEmail).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { message?: string; pageUrl?: string };
  const message = body.message?.trim();
  if (!message) {
    return NextResponse.json({ error: "Feedback message is required." }, { status: 400 });
  }

  const { data: user } = await User.get({ id: resolved.userId }).go();
  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  await Feedback.create({
    id: crypto.randomUUID(),
    userId: resolved.userId,
    userEmail: user.email,
    userName: user.name ?? "Plexo User",
    message,
    pageUrl: body.pageUrl?.trim() || undefined,
  }).go();

  await sendFeedbackNotificationEmail({
    userName: user.name ?? "Plexo User",
    userEmail: user.email,
    message,
    pageUrl: body.pageUrl?.trim() || null,
  }).catch((err) => console.error("Failed to send feedback notification email:", err));

  return NextResponse.json({ success: true });
}
