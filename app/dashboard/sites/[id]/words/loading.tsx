import { OptimisticLoader } from "../../../_v3/ui/OptimisticLoader";

/** A sub-page of a site: quiet skeleton shapes, not the full-screen page builder. */
export default function Loading() {
  return (
    <div className="plx-page" data-plexo-v3 style={{ padding: "clamp(16px, 3vw, 24px)" }}>
      <OptimisticLoader subtitle="Loading your words" />
    </div>
  );
}
