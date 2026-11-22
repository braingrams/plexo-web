import { notFound } from "next/navigation";
import { BrandPagePreview } from "./BrandPagePreview";

/** DEV ONLY: the whole Brand page (brand bible, words, fonts) with made-up data, for screenshots. ?view=page|empty */
export default function BrandPagePreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <BrandPagePreview />;
}
