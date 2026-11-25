"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { routeKey } from "@/lib/dashboardV3/tour";
import { useOptionalTour } from "./TourProvider";

/**
 * Drop this on a page that shows something only to some people (owners, a plan, a kind of site), next to the thing itself:
 * `<TourAnchorAbsent anchor="team-invite" absent={!canManage} />`. It tells the walkthrough whether the thing is on THIS page for THIS person,
 * so a step that points only at it is left out up front (and "N of M" stays right) instead of waiting for something that cannot appear.
 * Renders nothing. Pass `absent={false}` when it is there, so an earlier "not here" is cleared.
 */
export function TourAnchorAbsent({ anchor, absent = true }: { anchor: string; absent?: boolean }) {
  const report = useOptionalTour()?.reportAnchor;
  const scope = routeKey(usePathname() ?? "/", useSearchParams()?.toString() ?? "");
  useEffect(() => {
    report?.(scope, anchor, absent);
  }, [report, scope, anchor, absent]);
  return null;
}
