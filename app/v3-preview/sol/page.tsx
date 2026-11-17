import { notFound } from "next/navigation";
import { SolPreview } from "./SolPreview";

/**
 * DEV ONLY: SOL in the new look with made-up chats.
 * ?state=empty|chat|streaming|error|credit|share|sheet|canvas|ask|empty-list|loading
 */
export default function SolPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <SolPreview />;
}
