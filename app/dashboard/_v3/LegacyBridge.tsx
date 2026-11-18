import "./legacy.css";

/** Wraps a screen that still uses the old variable names so it takes the new brand colours inside the new dashboard. */
export function LegacyBridge({ children }: { children: React.ReactNode }) {
  return <div className="plx-legacy">{children}</div>;
}
