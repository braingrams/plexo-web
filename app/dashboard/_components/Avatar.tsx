"use client";

type Props = {
  name: string;
  email?: string;
  size?: number;
};

/** Shared gradient-initials avatar used by both dashboard shells and the Profile page. */
export function Avatar({ name, email = "", size = 36 }: Props) {
  const initials =
    name
      .split(" ")
      .map((p) => p[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || email.slice(0, 2).toUpperCase();

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "linear-gradient(135deg, var(--brand), var(--brand-deep))",
        display: "grid",
        placeItems: "center",
        fontSize: size * 0.32,
        fontWeight: 700,
        color: "#fff",
        fontFamily: "var(--font-heading), sans-serif",
        flexShrink: 0,
      }}
    >
      {initials}
    </div>
  );
}
