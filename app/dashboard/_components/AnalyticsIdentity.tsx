"use client";

import { useEffect } from "react";
import { trackUserIdentifiedOnce } from "@/lib/analytics";

// Sends user_identified once per page load for a signed-in account. Renders nothing.
export function AnalyticsIdentity({ userId, plan, status }: { userId: string; plan: string; status: string }) {
  useEffect(() => {
    trackUserIdentifiedOnce({ user_id: userId, plan_name: plan, plan_status: status });
  }, [userId, plan, status]);
  return null;
}
