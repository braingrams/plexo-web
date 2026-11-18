import { notFound } from "next/navigation";
import { HubPreview } from "./HubPreview";

/** DEV ONLY: the site hub with made-up data (?kind=store|site|blog|course|app &tab=… &exp=…). */
export default function HubPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <HubPreview />;
}
