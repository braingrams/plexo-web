import { notFound } from "next/navigation";
import { MockAnalyticsDataClient } from "@/lib/googleAnalytics/dataClient";
import { buildInsights } from "@/lib/googleAnalytics/insights";
import { VisitsPreview } from "./VisitsPreview";

/** DEV ONLY: the Visits tab with sample numbers (?state=on|off). */
export default async function VisitsPreviewPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const state = (await searchParams).state === "off" ? "off" : "on";
  const report = await new MockAnalyticsDataClient().getReport("preview", 28);
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() - (13 - i) * 86_400_000);
    return { label: d.toLocaleDateString("en", { month: "short", day: "numeric" }), views: Math.round(38 + 22 * Math.sin(i / 2) + i * 2) };
  });
  return <VisitsPreview state={state} visits={{ total: days.reduce((s, d) => s + d.views, 0), days }} report={report} insights={buildInsights(report)} />;
}
