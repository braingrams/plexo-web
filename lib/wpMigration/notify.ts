import { User } from "@/lib/db/coreEntities";
import { sendMaildripEmail } from "@/lib/mail/maildrip";
import { buildWpMigrationDoneEmail, buildWpMigrationPausedEmail } from "@/lib/mail/templates";
import type { MigrationReport } from "./report";

// Emails to the owner about their WordPress migration: a big site takes hours, so they're
// told they can close the tab — these are how they hear back. Never allowed to fail the
// migration itself: a mail outage only means no email.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL?.startsWith("http") ? process.env.NEXT_PUBLIC_APP_URL : "https://plexo.charisol.io";

export function migrationUrl(templateId: string, jobId: string): string {
  return `${APP_URL}/dashboard/migrate/wordpress?site=${templateId}&job=${jobId}`;
}

async function ownerEmail(userId: string): Promise<string | null> {
  const { data } = await User.get({ id: userId }).go();
  return data?.email ?? null;
}

export async function notifyMigrationDone(job: { templateId: string; id: string; createdBy: string }, report: MigrationReport): Promise<void> {
  try {
    const to = await ownerEmail(job.createdBy);
    if (!to) return;
    await sendMaildripEmail({
      to,
      subject: `${report.source.siteName || "Your site"} has moved to Plexo`,
      html: buildWpMigrationDoneEmail({
        siteName: escapeHtml(report.source.siteName || new URL(report.source.origin).host),
        pagesCopied: report.summary.pagesCopied,
        postsCopied: report.summary.postsCopied,
        productsMoved: report.summary.productsMoved,
        thingsToCheck: report.checklist.filter((c) => c.status === "blocked" || c.status === "todo" || c.status === "review").length,
        reportUrl: migrationUrl(job.templateId, job.id),
      }),
    });
  } catch (err) {
    console.error("[wp-migration] completion email failed", err);
  }
}

export async function notifyMigrationPaused(job: { templateId: string; id: string; createdBy: string }, siteName: string, reason: string): Promise<void> {
  try {
    const to = await ownerEmail(job.createdBy);
    if (!to) return;
    await sendMaildripEmail({
      to,
      subject: `Moving ${siteName || "your site"} to Plexo has paused`,
      html: buildWpMigrationPausedEmail({ siteName: escapeHtml(siteName || "your site"), reason: escapeHtml(reason), resumeUrl: migrationUrl(job.templateId, job.id) }),
    });
  } catch (err) {
    console.error("[wp-migration] paused email failed", err);
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
