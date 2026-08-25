import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { ensureActiveOrganization } from "@/server/org";
import { headers } from "next/headers";
import { ComingSoonPanel } from "../_components/ComingSoonPanel";

export default async function CommerceAvailabilityPage() {
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });
  if (!session?.user) redirect("/auth/login");
  const orgResolution = await ensureActiveOrganization(reqHeaders, session.user.id);
  if (orgResolution.status === "needs-choice") redirect("/choose-org");

  return (
    <ComingSoonPanel
      title="Availability"
      description="Set weekly open hours per service and block off specific dates — this is what powers the real calendar visitors see when they book a consultation."
      icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="1.8"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M8 2v4M16 2v4M3 10h18" /></svg>}
    />
  );
}
