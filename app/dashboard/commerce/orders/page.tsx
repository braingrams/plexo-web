import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { ensureActiveOrganization } from "@/server/org";
import { headers } from "next/headers";
import { ComingSoonPanel } from "../_components/ComingSoonPanel";

export default async function CommerceOrdersPage() {
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });
  if (!session?.user) redirect("/auth/login");
  const orgResolution = await ensureActiveOrganization(reqHeaders, session.user.id);
  if (orgResolution.status === "needs-choice") redirect("/choose-org");

  return (
    <ComingSoonPanel
      title="Orders"
      description="Every order, its payment and fulfillment status, and a refund action — the Overview page's recent-orders list moves here once there's enough volume to need its own page."
      icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="1.8"><path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" /><path d="M14 2v6h6" /></svg>}
    />
  );
}
