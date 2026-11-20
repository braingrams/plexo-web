import { notFound } from "next/navigation";
import { SectionsPreview } from "./SectionsPreview";

/** DEV ONLY: Your sections. ?view=list|empty|make|entries|entries-empty  &edit=1 opens the side form */
export default function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <SectionsPreview />;
}
