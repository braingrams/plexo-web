import { ImageResponse } from "next/og";
import { BRAND } from "@/lib/theme";
import { MARKETING_BLOG_DESCRIPTION } from "@/lib/blog/marketingBlog";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "The Plexo Blog";

// Share card for the /blog index. Post detail pages override this with their own
// colocated [slug]/opengraph-image.tsx.
export default function BlogOgImage() {
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
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div
            style={{
              width: 96,
              height: 96,
              borderRadius: 26,
              background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.deep})`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: `0 0 60px ${BRAND.glow}`,
            }}
          >
            <svg width={52} height={52} viewBox="0 0 24 24" fill="none">
              <path d="M12 2L4 7v5c0 4.97 3.35 9.63 8 10.93C17.65 21.63 21 16.97 21 12V7L12 2z" fill="white" opacity="0.95" />
              <path d="M9 12l2 2 4-4" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <span style={{ fontSize: 84, fontWeight: 800, color: "white", letterSpacing: "-0.03em" }}>Blog</span>
        </div>
        <span
          style={{
            marginTop: 28,
            fontSize: 28,
            color: "rgba(255,255,255,0.72)",
            letterSpacing: "-0.01em",
            maxWidth: 820,
            textAlign: "center",
          }}
        >
          {MARKETING_BLOG_DESCRIPTION}
        </span>
      </div>
    ),
    { ...size },
  );
}
