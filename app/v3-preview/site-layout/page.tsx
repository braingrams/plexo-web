import { notFound } from "next/navigation";
import { SiteLayoutPreview } from "./SiteLayoutPreview";

/** DEV ONLY: the Header and footer screen + per-page switches. ?scenario=old|designed|nodomain|plan|badcode|pixel|page */
export default function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <SiteLayoutPreview />;
}
