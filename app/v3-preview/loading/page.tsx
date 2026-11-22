import { notFound } from "next/navigation";
import { RouteLoading, type RouteLoadingShape } from "@/app/dashboard/_v3/shell/RouteLoading";

/** DEV ONLY: the page-loading screen. ?shape=hub|settings|list|cards */
export default async function LoadingPreview({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const q = await searchParams;
  const shape = (["hub", "settings", "list", "cards"].includes(q.shape ?? "") ? q.shape : "settings") as RouteLoadingShape;
  return (
    <div style={{ background: "var(--plx-bg)" }}>
      <RouteLoading shape={shape} />
    </div>
  );
}
