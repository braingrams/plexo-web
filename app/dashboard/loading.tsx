import { RouteLoading } from "./_v3/shell/RouteLoading";

/** Anything under /dashboard without its own loading screen: a skeleton in the new look (the classic dashboard keeps its own). */
export default function Loading() {
  return <RouteLoading shape="cards" />;
}
