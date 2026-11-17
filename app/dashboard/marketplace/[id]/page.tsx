import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/authDynamo";
import { getMarketplaceTemplateDetail } from "@/lib/marketplace";
import { currentUserOnNewDashboard } from "@/lib/dashboardV3/hubRedirect";
import { DesignDetail } from "../../_v3/designs/DesignDetail";
import { ClassicDesignPage } from "../_classic/ClassicDesignPage";

export const metadata = { title: "Design" };

/**
 * One design. Stripe sends buyers back here with ?purchase=success; signed-out visitors (and old
 * links from /marketplace/[id], see middleware) sign in first and land back on this page.
 * New-dashboard users see the new design; everyone else keeps the classic one.
 */
export default async function DashboardDesignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ purchase?: string }> }) {
  const { id } = await params;
  const { purchase } = await searchParams;
  const session = await auth();
  if (!session?.user) redirect(`/auth/login?redirectTo=${encodeURIComponent(`/dashboard/marketplace/${id}${purchase ? `?purchase=${encodeURIComponent(purchase)}` : ""}`)}`);

  const detail = await getMarketplaceTemplateDetail(id, session.user.id);
  if (!detail) notFound();
  if (await currentUserOnNewDashboard(session.user.id)) return <DesignDetail detail={detail} autoUse={purchase === "success" && detail.owned} />;
  return <ClassicDesignPage detail={detail} purchase={purchase} signedIn />;
}
