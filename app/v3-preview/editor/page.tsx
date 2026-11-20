import { notFound } from "next/navigation";
import { EditorPreview } from "./EditorPreview";

/** DEV ONLY: the Design | Code | Text editor. ?view=code|text|design|convert  &script=1 (page built by scripts, for the switch warning) */
export default function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <EditorPreview />;
}
