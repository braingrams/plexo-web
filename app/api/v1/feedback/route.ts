import { NextRequest, NextResponse } from "next/server";

import { User } from "@/lib/db/coreEntities";
import { Feedback } from "@/lib/db/contentEntities";
import { resolveUser } from "@/lib/auth/resolveUser";
import { sendFeedbackNotificationEmail } from "@/lib/email";
import { checkCommerceRateLimit } from "@/lib/commerceRateLimitDynamo";
import { uploadObject } from "@/lib/storage";
import { parseFeedbackBody } from "@/lib/struggle/validate";

const MAX_PER_10_MIN = 5;

/**
 * POST /api/v1/feedback
 *
 * Lets a logged-in user submit product feedback — stored for plexo-admin's Feedback queue
 * and immediately notified to ADMIN_EMAIL (see lib/email.ts's sendFeedbackNotificationEmail).
 * Used by both the always-there Feedback button and the "Having an issue?" nudge, which
 * adds type "struggle", the signals that made it appear, and an optional screenshot.
 * Only a whitelist of non-sensitive context is kept (path without query, browser name).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const resolved = await resolveUser(request);
  if (!resolved) {
    return NextResponse.json({ error: "Please sign in again to send feedback." }, { status: 401 });
  }

  const parsed = parseFeedbackBody(await request.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const input = parsed.value;

  const allowed = await checkCommerceRateLimit(`feedback:${resolved.userId}`, MAX_PER_10_MIN, 10 * 60_000).catch(() => true);
  if (!allowed) {
    return NextResponse.json(
      { error: "You have sent a few messages already, so we have them. Please try again in a few minutes." },
      { status: 429 },
    );
  }

  const { data: user } = await User.get({ id: resolved.userId }).go();
  if (!user) {
    return NextResponse.json({ error: "We could not find your account. Please sign in again." }, { status: 404 });
  }

  const id = crypto.randomUUID();
  let screenshotUrl: string | undefined;
  if (input.screenshot) {
    try {
      // Private: only the team can open it, via a signed link.
      screenshotUrl = (await uploadObject(`feedback/${resolved.userId}/${id}.${input.screenshot.ext}`, input.screenshot.bytes, {
        access: "private", contentType: input.screenshot.contentType,
      })).url;
    } catch (err) {
      // The message matters more than the picture: keep going without it.
      console.error("Feedback screenshot upload failed:", err);
    }
  }

  const signals = input.signals.length ? input.signals.join(",") : undefined;
  await Feedback.create({
    id,
    userId: resolved.userId,
    userEmail: user.email,
    userName: user.name ?? "Plexo User",
    message: input.message,
    pageUrl: input.pageUrl,
    type: input.type,
    category: input.category,
    signals,
    browser: input.browser,
    screenshotUrl,
  }).go();

  await sendFeedbackNotificationEmail({
    userName: user.name ?? "Plexo User",
    userEmail: user.email,
    message: input.message,
    pageUrl: input.pageUrl ?? null,
    signals: signals ?? null,
    category: input.category ?? null,
  }).catch((err) => console.error("Failed to send feedback notification email:", err));

  return NextResponse.json({ success: true, screenshotSaved: input.screenshot ? !!screenshotUrl : undefined });
}
