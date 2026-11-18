import { notFound } from "next/navigation";
import { LearnersPreview } from "./LearnersPreview";

/** DEV ONLY: learners + course screens with made-up data (?view=table|empty|lessons|settings &open=email &courses=1|2 &exp=…). */
export default function LearnersPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <LearnersPreview />;
}
