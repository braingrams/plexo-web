"use client";

import { useSearchParams } from "next/navigation";
import { AllSitesBoard, type BoardSite } from "@/app/dashboard/_v3/hub/AllSitesBoard";
import { WordsGuide, type GuidePage } from "@/app/dashboard/_v3/hub/WordsGuide";
import { parseStep, parseTopic } from "@/lib/dashboardV3/wordsFlow";
import type { SiteSummary } from "@/lib/dashboardV3/sites";

const SITES: SiteSummary[] = [
  { id: "s1", name: "Ama's Kitchen", kind: "Online store", status: "live", address: "amaskitchen.plexopages.com", updatedAt: "2026-11-15" },
  { id: "s2", name: "Cooking with Ama", kind: "Course", status: "live", address: "learn.amaskitchen.com", updatedAt: "2026-11-10" },
  { id: "s3", name: "Kitchen notes", kind: "Blog", status: "draft", updatedAt: "2026-11-02" },
  { id: "s4", name: "Lineage Care Foundation", kind: "Website", status: "live", address: "lineagecarefoundation.org", updatedAt: "2026-11-01", movedFrom: "https://lineagecarefoundation.org" },
  { id: "s5", name: "Ama's Pop-up Supper Club", kind: "Website", status: "draft", updatedAt: "2026-10-20" },
];
const stat = (id: string, label: string, value: string) => ({ id, label, value });
const ROWS: BoardSite[] = SITES.map((site, i) => ({
  site,
  stats: site.status === "live" ? [stat("visits", "Visits this week", (1284 - i * 410).toLocaleString("en-US")), stat(i === 1 ? "students" : "orders", i === 1 ? "Students" : "Orders", String(37 - i * 12))] : [],
}));
const PAGES: GuidePage[] = [
  { id: "p1", name: "Home", isRoot: true, sourceType: "BUILDER", editHref: "#" },
  { id: "p2", name: "About us", isRoot: false, sourceType: "BUILDER", editHref: "#" },
  { id: "p3", name: "Classes", isRoot: false, sourceType: "BUILDER", editHref: "#" },
  { id: "p4", name: "Contact", isRoot: false, sourceType: "BUILDER", editHref: "#" },
];

export function SitesPreview() {
  const q = useSearchParams();
  if (q.get("view") === "words") return <WordsGuide siteId="s1" siteName="Ama's Kitchen" pages={PAGES} topic={parseTopic(q.get("for"))} step={parseStep(q.get("step") ?? undefined, PAGES.length)} />;
  return <AllSitesBoard rows={ROWS} />;
}
