import { CSSProperties } from "react";

type Props = {
  children: React.ReactNode;
  style?: CSSProperties;
  className?: string;
};

/** The one top-level wrapper every dashboard page body should render inside — every page
 * gets the same fixed 1500px column and padding, full width up to that cap, no per-page
 * narrower variants. Keeps pages consistent instead of each one hand-rolling its own
 * (which had drifted: different padding shorthands and different max-widths per page). */
export function PageContainer({ children, style, className }: Props) {
  return (
    <div className={className} style={{ padding: "2rem 8px", maxWidth: 1500, width: "100%", margin: "0 auto", ...style }}>
      {children}
    </div>
  );
}
