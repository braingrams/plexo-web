import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { ensureActiveOrganization } from "@/server/org";
import { headers } from "next/headers";
import { ComingSoonPanel } from "../_components/ComingSoonPanel";

export default async function CommerceCustomersPage() {
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });
  if (!session?.user) redirect("/auth/login");
  const orgResolution = await ensureActiveOrganization(reqHeaders, session.user.id);
  if (orgResolution.status === "needs-choice") redirect("/choose-org");

  return (
    <ComingSoonPanel
      title="Customers"
      description="Everyone who's ever paid, drawn straight from your orders — no separate account system for them to sign up for."
      icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f472b6" strokeWidth="1.8"><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M16 4.2a3.2 3.2 0 0 1 0 6.2" /><path d="M19 14.3c1.8.7 3 2.5 3 4.7" /></svg>}
    />
  );
}
