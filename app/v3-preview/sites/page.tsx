import { notFound } from "next/navigation";
import { SitesPreview } from "./SitesPreview";

/** DEV ONLY: the all-sites board and the guided "Change the words" flow. ?view=board|words  &step=1..4  &for=words|contact|links */
export default function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <SitesPreview />;
}
