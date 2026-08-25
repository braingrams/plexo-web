import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { ensureActiveOrganization } from "@/server/org";
import { headers } from "next/headers";
import { ComingSoonPanel } from "../_components/ComingSoonPanel";

export default async function CommerceProductsPage() {
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });
  if (!session?.user) redirect("/auth/login");
  const orgResolution = await ensureActiveOrganization(reqHeaders, session.user.id);
  if (orgResolution.status === "needs-choice") redirect("/choose-org");

  return (
    <ComingSoonPanel
      title="Products"
      description="Add products and services, set prices, categories, and stock — landing here once the checkout and payment flow is live."
      icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#c084fc" strokeWidth="1.8"><path d="M3 9l2-5h14l2 5" /><path d="M3 9h18v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9z" /><path d="M9 13a3 3 0 0 0 6 0" /></svg>}
    />
  );
}
