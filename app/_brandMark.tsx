import { LOGO_MARK_INK, LOGO_MARK_SQUARE } from "@/app/dashboard/_v3/brand/logoPaths";
import { DARK_TOKENS, SHARED_TOKENS } from "@/lib/brandTokens";

/**
 * The Plexo "p" mark on a dark rounded tile — what app/icon.tsx and app/apple-icon.tsx render.
 * A dark tile keeps the mark readable on both light and dark browser tabs and home screens.
 */
export function BrandMarkTile({ size, radius, padding }: { size: number; radius: number; padding: number }) {
  const inner = size - padding * 2;
  return (
    <div style={{ width: size, height: size, borderRadius: radius, background: DARK_TOKENS["color-bg-canvas"], display: "flex", alignItems: "center", justifyContent: "center" }}>
      <svg width={(inner * 30) / 32} height={inner} viewBox="0 0 30 32" fill="none">
        <path d={LOGO_MARK_INK} fill={SHARED_TOKENS["logo-ink-on-dark"]} />
        <path d={LOGO_MARK_SQUARE} fill={SHARED_TOKENS["logo-mark"]} />
      </svg>
    </div>
  );
}
