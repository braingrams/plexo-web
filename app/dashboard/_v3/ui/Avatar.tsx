import { cx } from "./cx";

export function initialsOf(name: string, fallback = "?"): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const s = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? "").slice(0, 2);
  return s.toUpperCase() || fallback;
}

function toneOf(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 4;
}

/** A person's (or a site's) picture, or their initials on a brand colour. */
export function Avatar({ name, src, size = 40, square, className, color }: { name: string; src?: string | null; size?: number; square?: boolean; className?: string; color?: string }) {
  return (
    <span className={cx("plx-avatar", square && "plx-avatar--square", className)} data-tone={toneOf(name)} style={{ width: size, height: size, fontSize: Math.round(size * 0.4), ...(color && !src ? { background: color, color: "white" } : {}) }} aria-hidden={src ? undefined : true}>
      {src ? <img src={src} alt={name} /> : initialsOf(name)}
    </span>
  );
}
