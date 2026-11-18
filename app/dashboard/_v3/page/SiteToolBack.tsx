import "../hub/hub.css";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { currentUserOnNewDashboard } from "@/lib/dashboardV3/hubRedirect";
import { siteHubHref } from "@/lib/dashboardV3/hubPaths";

/**
 * The way back from a per-site tool page (form replies, redirects, blog settings ...) to the site's
 * home in the new dashboard. Shows only for people on the new dashboard, so the old dashboard
 * renders these pages exactly as before.
 */
export async function SiteToolBack({ siteId, tab = "settings", label }: { siteId: string; tab?: string; label?: string }) {
  if (!(await currentUserOnNewDashboard())) return null;
  return (
    <div style={{ padding: "20px 32px 0", maxWidth: 1920, margin: "0 auto", width: "100%" }}>
      <Link href={siteHubHref(siteId, tab)} className="plx-hub__back">
        <ArrowLeft size={18} aria-hidden /> {label ?? "Back to your site"}
      </Link>
    </div>
  );
}
