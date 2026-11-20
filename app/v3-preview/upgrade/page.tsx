import { notFound } from "next/navigation";
import { UpgradeScenes } from "./UpgradeScenes";

/** DEV ONLY: the upgrade prompt on each major surface, with made-up data (screenshots live in docs/screenshots/upgrade). */
export default async function V3PreviewUpgradePage({ searchParams }: { searchParams: Promise<{ scene?: string }> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const { scene } = await searchParams;
  return <UpgradeScenes scene={scene ?? "payments"} />;
}
