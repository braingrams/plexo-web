import { notFound } from "next/navigation";
import { EmailsPreview } from "./EmailsPreview";

/** DEV ONLY: the emails library with made-up data (?state=ok|limit|empty &dialog=blank|design &exp=…). */
export default function EmailsPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <EmailsPreview />;
}
