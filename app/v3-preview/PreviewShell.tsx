"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { buildV3Nav, parseExperience, type BuildGoal, type Experience } from "@/lib/dashboardV3/nav";
import type { SiteSummary } from "@/lib/dashboardV3/sites";
import { INITIAL_TOUR_STATE, type TourStep } from "@/lib/dashboardV3/tour";
import { TOUR_STEPS } from "@/lib/dashboardV3/tourSteps";
import { V3Shell } from "@/app/dashboard/_v3/shell/V3Shell";

export const PREVIEW_SITES: SiteSummary[] = [
  { id: "s1", name: "Ama's Kitchen", kind: "Online store", status: "live", address: "amaskitchen.plexopages.com", updatedAt: "2026-11-15" },
  { id: "s2", name: "Cooking with Ama", kind: "Course", status: "live", address: "learn.amaskitchen.com", updatedAt: "2026-11-10" },
  { id: "s3", name: "Kitchen notes", kind: "Blog", status: "draft", updatedAt: "2026-11-02" },
];

// The real steps, pointed at the preview's pages.
const previewTour = (home: string): TourStep[] => TOUR_STEPS.map((s) => ({
  ...s,
  route: s.route === "/dashboard" ? home : typeof s.route === "string" && s.route.startsWith("/dashboard/settings") ? s.route.replace("/dashboard/settings", "/v3-preview/settings") : typeof s.route === "function" ? () => null : s.route,
}));

export function PreviewShell({ children }: { children: React.ReactNode }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const homePath = pathname.startsWith("/v3-preview/home") ? "/v3-preview/home" : "/v3-preview";
  const [experience, setExperience] = useState<Experience>(parseExperience(params.get("exp")) ?? "beginner");
  const goal = (params.get("goal") as BuildGoal | null) ?? "store";
  const [site, setSite] = useState("s1");
  const nav = useMemo(
    () => buildV3Nav({ experience, goal, siteCount: PREVIEW_SITES.length }).map((n) => (n.id === "home" ? { ...n, href: homePath } : n.id === "settings" ? { ...n, href: "/v3-preview/settings" } : n)),
    [experience, goal],
  );
  return (
    <V3Shell
      user={{ name: "Ama Owusu", email: "ama@amaskitchen.com" }}
      experience={experience}
      nav={nav}
      sites={PREVIEW_SITES}
      currentSiteId={site}
      tourState={params.get("tour") === "active" ? { status: "active", mode: "short", stepId: "home-intro" } : INITIAL_TOUR_STATE}
      tourSteps={previewTour(homePath)}
      tourOfferOn={params.get("tour") === "offer" ? [homePath] : []}
      tourAutoDrive={params.get("tour") === "active"}
      persist={false}
      onExperienceChange={setExperience}
      onSiteSelect={setSite}
    >
      {children}
    </V3Shell>
  );
}
