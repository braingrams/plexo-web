import { cookies } from "next/headers";
import { Template, LmsFunnel, LmsEnrollment } from "@/lib/db/contentEntities";
import { lmsSessionCookieName, verifyLmsSession } from "@/lib/lms/session";
import { SignupClient } from "./SignupClient";
import { PortalClient } from "./PortalClient";

/** Visitor-facing entry point for a funnel: signup form for a first-time visitor, the
 * learner portal for anyone with a valid session cookie. One route handles both states so
 * a bookmarked link always does the right thing, per the Funnel/LMS plan's visitor flow. */
export default async function LearnPage({
  params, searchParams,
}: {
  params: Promise<{ templateId: string }>;
  searchParams: Promise<{ error?: string; welcome?: string; plexo_lms_signup_paid?: string }>;
}) {
  const { templateId } = await params;
  const { error, welcome, plexo_lms_signup_paid: paidReturn } = await searchParams;

  const [{ data: site }, { data: funnel }] = await Promise.all([
    Template.get({ id: templateId }).go(),
    LmsFunnel.get({ templateId }).go(),
  ]);

  if (!site || !funnel || !funnel.enabled) {
    return (
      <CenteredShell>
        <p style={{ color: "rgba(240,242,255,0.6)" }}>This funnel isn't available right now.</p>
      </CenteredShell>
    );
  }

  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(lmsSessionCookieName(templateId))?.value;
  const payload = sessionToken ? await verifyLmsSession(sessionToken) : null;

  if (payload && payload.templateId === templateId) {
    const { data: enrollment } = await LmsEnrollment.get({ templateId, email: payload.email }).go();
    if (enrollment && enrollment.status === "ACTIVE") {
      return <PortalClient templateId={templateId} funnelName={site.name} showWelcome={welcome === "1"} />;
    }
  }

  return <SignupClient templateId={templateId} funnelName={site.name} errorMessage={error ?? null} paidReturn={paidReturn === "1"} />;
}

function CenteredShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0b0d16", padding: "1.5rem" }}>
      {children}
    </div>
  );
}
