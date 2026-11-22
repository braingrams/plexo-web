/** SOL's glyph: a small sun (sol = sun), a ring around a bright centre. Deliberately not a sparkle. Pure, so it can be drawn anywhere (chat, splash). */
export function SolGlyph({ size = 18 }: { size?: number; strokeWidth?: number; "aria-hidden"?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2.4" />
      <circle cx="12" cy="12" r="3.6" fill="currentColor" />
    </svg>
  );
}
