import { notFound } from "next/navigation";
import { BrandPreview } from "./BrandPreview";

/** DEV ONLY: the "Your brand" picker in every state, with made-up Strata data. ?state=list|empty|not-connected|error|loading|linked|unlinked|newsite|createoff &theme=… */
export default function BrandPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <BrandPreview />;
}
