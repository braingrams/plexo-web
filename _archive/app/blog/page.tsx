import type { Metadata } from "next";
import { Sparkles } from "lucide-react";

import { LandingNav } from "../landing-nav";
import { listPublishedPosts } from "@/lib/blog/queriesDynamo";
import { MARKETING_BLOG_TEMPLATE_ID, MARKETING_BLOG_TAGLINE, MARKETING_BLOG_DESCRIPTION } from "@/lib/blog/marketingBlog";
import { listingMetadata, listingJsonLd } from "@/lib/blog/marketingSeo";
import { JsonLd, PostCard } from "./blog-ui";

// ISR: same 60s stale-while-revalidate the per-tenant blog pages use — new/edited posts
// appear within a minute without a redeploy, and the page is still statically served.
export const revalidate = 60;

export function generateMetadata(): Metadata {
  return listingMetadata();
}

export default async function BlogIndexPage() {
  // Single-page listing of the latest posts. When the marketing blog grows past this,
  // numbered pagination (/blog/page/[n]) can be added mirroring the pub blog — every query
  // here already supports it via ListPostsOptions.
  const { posts } = await listPublishedPosts(MARKETING_BLOG_TEMPLATE_ID, { page: 1, perPage: 60 });

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-main)] selection:bg-[var(--brand)] selection:text-white transition-colors duration-300">
      <LandingNav />

      <section className="relative pt-24 pb-10 px-5 sm:px-6 overflow-hidden border-b border-[var(--surface-border)]">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-5xl h-[280px] bg-gradient-to-b from-[var(--brand-glow)] via-transparent to-transparent blur-3xl pointer-events-none -z-10" />

        <div className="max-w-2xl mx-auto flex flex-col items-center text-center">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--surface)] border border-[var(--brand-glow)] text-[11px] font-semibold text-[var(--brand)] mb-4">
            <Sparkles className="w-3 h-3" />
            <span>{MARKETING_BLOG_TAGLINE}</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight mb-3">Blog</h1>
          <p className="text-sm text-[var(--text-muted)] max-w-md leading-relaxed">{MARKETING_BLOG_DESCRIPTION}</p>
        </div>
      </section>

      <main className="max-w-5xl mx-auto px-5 sm:px-6 py-10">
        {posts.length === 0 ? (
          <p className="text-center text-sm text-[var(--text-muted)] py-24">No posts published yet — check back soon.</p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        )}
      </main>

      <JsonLd items={listingJsonLd(posts)} />
    </div>
  );
}
