import { notFound } from "next/navigation";
import { PlanStripPreview } from "./PlanStripPreview";

/** DEV ONLY: the one plan strip above the editors. ?case=free-pages|offline */
export default function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <PlanStripPreview />;
}
