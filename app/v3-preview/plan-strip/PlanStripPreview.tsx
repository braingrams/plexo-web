"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { SitePlanNotice } from "@/app/dashboard/_components/SitePlanNotice";
import { EditorFrame } from "@/app/dashboard/_components/EditorTheme";
import { installMock } from "../_mock/api";

export function PlanStripPreview() {
  const q = useSearchParams();
  const offline = q.get("case") === "offline";
  useState(() => installMock([{ test: /\/api\/v1\/plan\/site/, res: () => ({
    plan: "FREE", previousPlan: null, trialAvailable: true, homeOnly: true, isApp: false, isSecondaryPage: !offline,
    site: { id: "p1", name: "Ama's Kitchen", isLive: !offline, liveAddress: offline ? null : "amaskitchen.plexopages.com", pausedCustomDomains: [], everPublished: !offline },
    otherLiveSite: offline ? { id: "o", name: "Cooking with Ama" } : null,
    pageCount: 4, unpublishedPageCount: 3, archivedByPlanPageCount: 0,
    secondaryLinks: [{ href: "/about", label: "About us" }, { href: "/contact", label: "Contact" }],
  }) }]));
  return (
    <EditorFrame v3>
      <SitePlanNotice templateId="p1" />
    </EditorFrame>
  );
}
