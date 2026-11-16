import { notFound } from "next/navigation";
import { HomeView } from "@/app/dashboard/_v3/home/HomeView";
import type { HomeProps, HomeSiteRow } from "@/app/dashboard/_v3/home/homeTypes";
import { computeTasks, EMPTY_FACTS, type SiteFacts } from "@/lib/dashboardV3/tasks";
import type { SiteStats } from "@/lib/dashboardV3/homeData";
import type { SiteSummary } from "@/lib/dashboardV3/sites";

// Same made-up sites the preview shell shows (kept here: that module is a client file).
const PREVIEW_SITES: SiteSummary[] = [
  { id: "s1", name: "Ama's Kitchen", kind: "Online store", status: "live", address: "amaskitchen.plexopages.com", updatedAt: "2026-11-15" },
  { id: "s2", name: "Cooking with Ama", kind: "Course", status: "live", address: "learn.amaskitchen.com", updatedAt: "2026-11-10" },
  { id: "s3", name: "Kitchen notes", kind: "Blog", status: "draft", updatedAt: "2026-11-02" },
];

const BRAND = { name: "Ama's Kitchen", color: "oklch(62% 0.19 38)" };
const STORE_STATS: SiteStats = {
  stats: [
    { id: "visits", label: "Visits this week", value: "1,284" },
    { id: "orders", label: "Orders", value: "37", hint: "31 paid" },
    { id: "sales", label: "Sales this month", value: "₦412,500" },
  ],
  activityTitle: "Latest orders",
  activityEmpty: "No orders yet.",
  activity: [
    { id: "1", who: "Kemi Adeyemi", amount: "₦17,000", when: new Date(Date.now() - 12 * 60000).toISOString(), paid: true },
    { id: "2", who: "Tunde Bakare", amount: "₦8,500", when: new Date(Date.now() - 3 * 3600000).toISOString(), paid: false },
    { id: "3", who: "Ngozi Eze", amount: "₦25,500", when: new Date(Date.now() - 26 * 3600000).toISOString(), paid: true },
  ],
};

/** DEV ONLY: Home with made-up data. ?state=guided|skipped|live|all  &exp=beginner|intermediate|pro  &step=0..5 */
export default async function HomePreview({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const q = await searchParams;
  const state = q.state ?? "guided";
  const step = state === "live" ? 9 : Number(q.step ?? 2);
  const experience = (q.exp as HomeProps["experience"]) ?? (state === "all" ? "pro" : "beginner");
  const site = { ...PREVIEW_SITES[0], status: state === "live" ? ("live" as const) : ("draft" as const), address: state === "guided" && step < 4 ? null : PREVIEW_SITES[0].address };
  const facts: SiteFacts = {
    ...EMPTY_FACTS,
    hasSite: true,
    hasLogo: step > 1,
    hasColors: step > 1,
    productCount: step > 2 ? 3 : 0,
    paymentsReady: step > 3,
    hasAddress: step > 4 || state === "live",
    published: state === "live",
  };
  const progress = computeTasks("store", facts);
  const rows: HomeSiteRow[] = PREVIEW_SITES.map((s, i) => ({
    site: s,
    stats: i === 0 ? STORE_STATS : { ...STORE_STATS, stats: [{ id: "visits", label: "Visits this week", value: String(240 - i * 90) }, { id: "students", label: "Students", value: String(18 - i * 9) }] },
  }));
  const props: HomeProps = {
    firstName: "Ama",
    experience,
    mode: state === "skipped" ? "none" : state === "all" ? "all" : "site",
    site: { site, progress, commerceEnabled: true, stats: progress.allDone ? STORE_STATS : null },
    all: rows,
    brand: BRAND,
    baseDomain: "plexopages.com",
    newSiteHref: "/welcome/setup?new=1",
    demo: true,
  };
  return <HomeView {...props} />;
}
