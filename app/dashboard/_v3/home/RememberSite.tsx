"use client";

import { useEffect } from "react";
import { CURRENT_SITE_COOKIE } from "@/lib/dashboardV3/sites";

/** Writes the current-site cookie when it was missing or pointed at a site that is gone, so every page agrees. */
export function RememberSite({ siteId }: { siteId: string }) {
  useEffect(() => {
    try {
      document.cookie = `${CURRENT_SITE_COOKIE}=${encodeURIComponent(siteId)}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
    } catch {
      /* the page still works from the most recent site */
    }
  }, [siteId]);
  return null;
}
