import Link from "next/link";
import type { CSSProperties } from "react";

type Props = {
  size?: number;
  showText?: boolean;
  href?: string | null;
  textStyle?: CSSProperties;
};

/** Single source of truth for the Plexo mark — previously copy-pasted between
 * app/page.tsx and app/landing-nav.tsx (and re-implemented again inline in
 * server/auth.ts's transactional emails, which stays separate since it renders to a
 * static HTML string, not React). */
export function PlexoLogo({ size = 34, showText = true, href = "/", textStyle }: Props) {
  const content = (
    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.26),
          background: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
          display: "grid",
          placeItems: "center",
          boxShadow: "0 0 16px rgba(139,92,246,0.45)",
          flexShrink: 0,
        }}
      >
        <svg width={size * 0.53} height={size * 0.53} viewBox="0 0 24 24" fill="none">
          <path d="M12 2L4 7v5c0 4.97 3.35 9.63 8 10.93C17.65 21.63 21 16.97 21 12V7L12 2z" fill="white" opacity="0.95" />
          <path d="M9 12l2 2 4-4" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      {showText && (
        <span
          style={{
            fontFamily: "var(--font-heading), sans-serif",
            fontWeight: 800,
            fontSize: `${(size / 34) * 1.2}rem`,
            color: "var(--text-main)",
            letterSpacing: "-0.03em",
            ...textStyle,
          }}
        >
          Plexo
        </span>
      )}
    </div>
  );

  if (!href) return content;
  return (
    <Link href={href} style={{ textDecoration: "none" }}>
      {content}
    </Link>
  );
}
