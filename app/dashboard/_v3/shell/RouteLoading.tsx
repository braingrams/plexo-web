import { PageSkeleton } from "../../_components/PageSkeleton";
import { Skeleton } from "../ui/Skeleton";

export type RouteLoadingShape = "settings" | "hub" | "list" | "cards";

const Bar = ({ w, h = 14 }: { w: number | string; h?: number }) => <Skeleton width={w} height={h} />;

function Tabs({ n, w = 92 }: { n: number; w?: number }) {
  return (
    <div className="plx-ldg__tabs">
      {Array.from({ length: n }, (_, i) => <Skeleton key={i} width={w} height={32} radius={10} />)}
    </div>
  );
}

function Cards({ n, h = 120 }: { n: number; h?: number }) {
  return (
    <div className="plx-ldg__grid">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="plx-ldg__card">
          <Skeleton width={44} height={44} radius={12} />
          <Bar w="60%" h={16} />
          <Bar w="90%" />
          {h > 100 ? <Bar w="40%" /> : null}
        </div>
      ))}
    </div>
  );
}

function Shape({ shape }: { shape: RouteLoadingShape }) {
  if (shape === "settings")
    return (
      <>
        <div className="plx-ldg__head"><Bar w={160} h={34} /></div>
        <Tabs n={6} w={110} />
        <div className="plx-ldg__list">
          <div className="plx-ldg__card"><Bar w="30%" h={18} /><Bar w="70%" /><Skeleton height={44} radius={12} /></div>
          <div className="plx-ldg__card"><Bar w="25%" h={18} /><Bar w="60%" /><Skeleton height={44} radius={12} /></div>
        </div>
      </>
    );
  if (shape === "hub")
    return (
      <>
        <Bar w={90} />
        <div className="plx-ldg__head"><Bar w="min(320px, 70%)" h={34} /><Bar w="min(240px, 50%)" /></div>
        <Tabs n={6} />
        <Cards n={6} />
      </>
    );
  if (shape === "list")
    return (
      <>
        <div className="plx-ldg__head"><Bar w={200} h={34} /><Bar w="min(320px, 70%)" /></div>
        <div className="plx-ldg__list">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="plx-ldg__card" style={{ flexDirection: "row", alignItems: "center" }}>
              <Skeleton width={56} height={56} radius={12} />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}><Bar w="40%" h={16} /><Bar w="25%" /></div>
            </div>
          ))}
        </div>
      </>
    );
  return (
    <>
      <div className="plx-ldg__head"><Bar w={200} h={34} /><Bar w="min(320px, 70%)" /></div>
      <Cards n={6} />
    </>
  );
}

/**
 * What a dashboard page that is still loading shows in the content area: a skeleton shaped like the
 * destination, in the new look. People on the classic dashboard keep their existing skeleton (the
 * classes only apply inside the new dashboard).
 */
export function RouteLoading({ shape }: { shape: RouteLoadingShape }) {
  return (
    <>
      <div className="plx-ldg-classic"><PageSkeleton /></div>
      <div className="plx-ldg plx-page" aria-busy="true" role="status" aria-label="Loading">
        <Shape shape={shape} />
      </div>
    </>
  );
}
