import { notFound } from "next/navigation";
import { MigratePreview, MIGRATE_STATES } from "../MigratePreview";

/** DEV ONLY: one migration screen with fake data. */
export default async function V3PreviewMigratePage({ params }: { params: Promise<{ state: string }> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const { state } = await params;
  if (!MIGRATE_STATES.includes(state)) notFound();
  return <MigratePreview state={state} />;
}
