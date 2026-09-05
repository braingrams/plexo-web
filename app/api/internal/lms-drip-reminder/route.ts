import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdmin } from "@/server/adminAuth";
import { isCronRequest } from "@/lib/cronAuth";
import { LmsEnrollment, LmsPage, LmsPageProgress, Template } from "@/lib/db/contentEntities";
import { evaluatePageUnlock, buildProgressMap, type LmsUnlockCondition } from "@/lib/lms/rules";
import { sendMaildripEmail } from "@/lib/mail/maildrip";
import { buildLmsDripReadyEmail } from "@/lib/mail/templates";
import { logEmailDelivery } from "@/lib/mail/logEmail";

function hasTimeDripCondition(conditions: LmsUnlockCondition[]): boolean {
  return conditions.some((c) => c.type === "TIME_DRIP_RELATIVE" || c.type === "TIME_DRIP_FIXED_DATE");
}

/**
 * GET /api/internal/lms-drip-reminder
 *
 * Optional, non-blocking backstop (see the Funnel/LMS plan's "Background jobs" section):
 * nothing about unlocking itself depends on this — evaluatePageUnlock is computed at read
 * time on every learner-portal visit regardless. This only sends a "your next lesson is
 * ready" nudge for pages gated on a TIME_DRIP condition, so a learner who isn't actively
 * checking back still finds out. Daily, like this app's other catch-up-sweep crons.
 *
 * LmsEnrollment has no platform-wide access pattern (scoped by templateId — see its own
 * comment in contentEntities.ts) — a bounded Scan, filtered in application code, is the
 * same honest v1 answer app/api/internal/commerce/expire-stale-holds/route.ts already gives
 * for the identical shape of problem, not a speculative GSI on a low-frequency daily job.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronRequest(request) && !isAuthorizedAdmin(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  type EnrollmentRow = { templateId: string; email: string; status?: string; enrolledAt?: string };
  const allEnrollments: EnrollmentRow[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: { data: EnrollmentRow[]; cursor: string | null } = await LmsEnrollment.scan.go({ cursor });
    allEnrollments.push(...page.data);
    cursor = page.cursor;
    if (!cursor) break;
  }

  const activeEnrollments = allEnrollments.filter((e) => (e.status ?? "ACTIVE") === "ACTIVE");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const siteNameCache = new Map<string, string>();

  let remindersSent = 0;
  for (const enrollment of activeEnrollments) {
    const [{ data: pages }, { data: progressRows }] = await Promise.all([
      LmsPage.query.byOrder({ templateId: enrollment.templateId }).go({ pages: "all" }),
      LmsPageProgress.query.primary({ templateId: enrollment.templateId, email: enrollment.email }).go({ pages: "all" }),
    ]);
    const progressByPageId = buildProgressMap(progressRows);

    for (const page of pages) {
      if (page.visible === false) continue;
      const conditions = page.unlockRules?.conditions ?? [];
      if (!hasTimeDripCondition(conditions)) continue;

      const existingProgress = progressByPageId.get(page.id);
      if (existingProgress?.completedAt || existingProgress?.firstViewedAt || existingProgress?.dripReminderSentAt) continue;

      const result = evaluatePageUnlock(page, { enrolledAt: enrollment.enrolledAt ?? new Date().toISOString() }, progressByPageId);
      if (!result.unlocked) continue;

      if (!siteNameCache.has(enrollment.templateId)) {
        const { data: site } = await Template.get({ id: enrollment.templateId }).go();
        siteNameCache.set(enrollment.templateId, site?.name ?? "your funnel");
      }
      const funnelName = siteNameCache.get(enrollment.templateId)!;
      const portalUrl = `${appUrl}/learn/${enrollment.templateId}`;
      const subject = `${page.title} is ready in ${funnelName}`;

      try {
        await sendMaildripEmail({ to: enrollment.email, subject, html: buildLmsDripReadyEmail(funnelName, page.title, portalUrl) });
        logEmailDelivery({ kind: "maildrip", to: enrollment.email, subject, status: "sent", context: "lms_drip_ready", templateId: enrollment.templateId });
        remindersSent++;
      } catch (err) {
        logEmailDelivery({
          kind: "maildrip", to: enrollment.email, subject, status: "failed",
          errorMessage: err instanceof Error ? err.message : String(err), context: "lms_drip_ready", templateId: enrollment.templateId,
        });
        continue; // don't mark as sent — try again tomorrow
      }

      await LmsPageProgress.upsert({
        templateId: enrollment.templateId,
        email: enrollment.email,
        pageId: page.id,
        dripReminderSentAt: new Date().toISOString(),
      }).go();
    }
  }

  return NextResponse.json({ remindersSent });
}
