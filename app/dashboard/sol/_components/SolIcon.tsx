/**
 * SOL's mark, deliberately derived from the actual Plexo shield glyph (the same path used
 * for the brand logo in dashboard-shell-modern.tsx/ThreadSidebar's own Plexo wordmark) with
 * a small sparkle accent added inside it — SOL reads as "Plexo, AI-powered," not as an
 * unrelated icon, the way a plain lucide Sparkles glyph did everywhere before this.
 */
export function SolIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 2L4 7v5c0 4.97 3.35 9.63 8 10.93C17.65 21.63 21 16.97 21 12V7L12 2z" fill="currentColor" opacity="0.95" />
      <g transform="translate(7.6,7) scale(0.38)">
        <path d="M12 2l2.2 6.3L20.5 10.5l-6.3 2.2L12 19l-2.2-6.3L3.5 10.5l6.3-2.2L12 2z" fill="white" />
      </g>
    </svg>
  );
}
