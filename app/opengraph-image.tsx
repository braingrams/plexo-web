import { ImageResponse } from "next/og";
import { BRAND } from "@/lib/theme";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Shared OG/Twitter share image for the marketing site. Page-specific routes
 * (e.g. marketplace/[id]) override this by exporting their own opengraph-image
 * from the same route segment — this one is the fallback for everything else.
 */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b0f19",
          backgroundImage: `radial-gradient(circle at 30% 20%, ${BRAND.subtle}, transparent 60%), radial-gradient(circle at 80% 80%, rgba(139,92,246,0.12), transparent 55%)`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <div
            style={{
              width: 120,
              height: 120,
              borderRadius: 30,
              background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.deep})`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: `0 0 60px ${BRAND.glow}`,
            }}
          >
            <svg width={64} height={64} viewBox="0 0 24 24" fill="none">
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
          <span
            style={{
              fontSize: 96,
              fontWeight: 800,
              color: "white",
              letterSpacing: "-0.03em",
            }}
          >
            Plexo
          </span>
        </div>
        <span
          style={{
            marginTop: 28,
            fontSize: 32,
            color: "rgba(255,255,255,0.75)",
            letterSpacing: "-0.01em",
          }}
        >
          Visual Template Builder for Email &amp; Landing Pages
        </span>
      </div>
    ),
    { ...size }
  );
}
