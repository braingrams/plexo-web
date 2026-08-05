import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/server/prisma";
import { resolveUser } from "@/app/api/v1/domains/route";
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

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: resolved.userId },
    select: { name: true, email: true },
  });

  await prisma.feedback.create({
    data: {
      userId: resolved.userId,
      userEmail: user.email,
      userName: user.name,
      message,
      pageUrl: body.pageUrl?.trim() || null,
    },
  });

  await sendFeedbackNotificationEmail({
    userName: user.name,
    userEmail: user.email,
    message,
    pageUrl: body.pageUrl?.trim() || null,
  }).catch((err) => console.error("Failed to send feedback notification email:", err));

  return NextResponse.json({ success: true });
}
