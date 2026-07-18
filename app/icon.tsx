import { ImageResponse } from "next/og";
import { BRAND } from "@/lib/theme";

/* ── Size & format ───────────────────────────────────────── */
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/**
 * Plexo logo mark favicon.
 * Rendered via Next.js ImageResponse — no static file needed.
 * To swap the icon tomorrow just edit BRAND in lib/theme.ts.
 */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.deep})`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Shield path */}
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
        >
          <path
            d="M12 2L4 7v5c0 4.97 3.35 9.63 8 10.93C17.65 21.63 21 16.97 21 12V7L12 2z"
            fill="white"
            opacity="0.95"
          />
          <path
            d="M9 12l2 2 4-4"
            stroke="white"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    ),
    {
      ...size,
    }
  );
}
