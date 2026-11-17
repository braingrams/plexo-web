import { requireHubContext } from "@/lib/dashboardV3/hubData";
import { emailLimitFor } from "@/lib/dashboardV3/emails";
import { loadEmails } from "@/lib/dashboardV3/emailsData";
import { PLAN_LABELS } from "@/lib/plan/plans";
import { EmailsLibrary } from "../_v3/emails/EmailsLibrary";

export const dynamic = "force-dynamic";
export const metadata = { title: "Emails" };

/** Email designs only (v3 dashboard). The old Templates page sends people here when v3 is on. */
export default async function EmailsPage() {
  const ctx = await requireHubContext("/dashboard/emails");
  const emails = await loadEmails(ctx.organizationId);
  return <EmailsLibrary initial={emails} limit={emailLimitFor(ctx.plan)} planName={PLAN_LABELS[ctx.plan] ?? "Free"} />;
}
