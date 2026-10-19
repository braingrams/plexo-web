import { ImageResponse } from "next/og";
import { BRAND } from "@/lib/theme";
import { getPublishedPostBySlug } from "@/lib/blog/queriesDynamo";
import { MARKETING_BLOG_TEMPLATE_ID } from "@/lib/blog/marketingBlog";

export const revalidate = 60;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Plexo blog post";

// Per-post share card, generated only when the post has no ogImageUrl/featuredImageUrl of
// its own (those are set directly on the metadata in marketingSeo.ts and take precedence).
// Mirrors the root app/opengraph-image.tsx brand treatment, with the post title + author.
export default async function BlogPostOgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPublishedPostBySlug(MARKETING_BLOG_TEMPLATE_ID, slug);
  const title = post?.title ?? "Plexo Blog";
  const author = post?.author?.name ?? null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "#0b0f19",
          backgroundImage: `radial-gradient(circle at 20% 15%, ${BRAND.subtle}, transparent 55%), radial-gradient(circle at 85% 90%, rgba(var(--brand-rgb), 0.14), transparent 55%)`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: `linear-gradient(135deg, ${BRAND.primary}, ${BRAND.deep})`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: `0 0 40px ${BRAND.glow}`,
            }}
          >
            <svg width={32} height={32} viewBox="0 0 24 24" fill="none">
              <path d="M12 2L4 7v5c0 4.97 3.35 9.63 8 10.93C17.65 21.63 21 16.97 21 12V7L12 2z" fill="white" opacity="0.95" />
              <path d="M9 12l2 2 4-4" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <span style={{ fontSize: 30, fontWeight: 700, color: "white", letterSpacing: "-0.02em" }}>Plexo Blog</span>
        </div>

        <div
          style={{
            display: "flex",
            fontSize: title.length > 70 ? 56 : 68,
            fontWeight: 800,
            color: "white",
            letterSpacing: "-0.03em",
            lineHeight: 1.1,
            // next/og needs an explicit line clamp for long titles.
            maxHeight: 300,
            overflow: "hidden",
          }}
        >
          {title}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 26, color: "rgba(255,255,255,0.72)" }}>
          {author ? <span>{author}</span> : <span>plexo.io</span>}
        </div>
      </div>
    ),
    { ...size },
  );
}
