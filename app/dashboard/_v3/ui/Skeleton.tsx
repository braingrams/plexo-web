import { cx } from "./cx";

/** A shimmering placeholder while something loads. Give the parent `aria-busy`. */
export function Skeleton({ width = "100%", height = 16, radius, className, style }: { width?: number | string; height?: number | string; radius?: number | string; className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden className={cx("plx-skel", className)} style={{ width, height, borderRadius: radius, ...style }} />;
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 10 }} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={12} width={i === lines - 1 ? "60%" : "100%"} />
      ))}
    </span>
  );
}
