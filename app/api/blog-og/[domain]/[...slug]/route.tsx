import { ImageResponse } from "next/og";
import { resolveBlogSite } from "@/lib/pub/resolveSite";
import { getPublishedPostBySlug } from "@/lib/blog/queries";

// A plain Route Handler, not Next's opengraph-image file convention — that convention
// forbids colocating inside a catch-all segment ("Catch-all must be the last part of
// the URL"), which app/pub/[domain]/blog/[...slug] is (deliberately, so old WordPress
// permalinks already prefixed with "/blog/..." still resolve — see that page's own
// comment). Only ever referenced from lib/blog/seo.ts's postMetadata when a post has no
// featuredImageUrl/ogImageUrl of its own to link to directly.
export async function GET(
  request: Request,
  context: { params: Promise<{ domain: string; slug: string[] }> },
): Promise<Response> {
  const { domain: rawDomain, slug } = await context.params;
  const domain = decodeURIComponent(rawDomain);
  const site = await resolveBlogSite(domain);

  let title = "Blog";
  let subtitle: string | undefined;
  if (site.status === "ok" && slug.length === 1) {
    const post = await getPublishedPostBySlug(site.published.templateId, slug[0]);
    if (post) {
      title = post.title;
      subtitle = site.blogSite.title;
    }
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 80,
          background: "linear-gradient(135deg,#0b0f19,#1e1b3a)",
          color: "#fff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 28, opacity: 0.7, marginBottom: 24 }}>{subtitle ?? "Blog"}</div>
        <div style={{ fontSize: 56, fontWeight: 800, lineHeight: 1.15 }}>{title}</div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
