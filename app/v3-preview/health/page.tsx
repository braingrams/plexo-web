import { notFound } from "next/navigation";
import { HealthPreview } from "./HealthPreview";
import { healthPayload, type HealthScenario } from "./fixtures";

/** DEV ONLY: the Site health tab with made-up results (?scenario=slow|fast). */
export default async function HealthPreviewPage({ searchParams }: { searchParams: Promise<{ scenario?: string }> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const scenario: HealthScenario = (await searchParams).scenario === "fast" ? "fast" : "slow";
  return <HealthPreview payload={JSON.parse(JSON.stringify(healthPayload(scenario)))} />;
}
