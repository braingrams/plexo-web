import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { LandingNav } from "../../landing-nav";
import { getPublishedPostBySlug, getRelatedPosts } from "@/lib/blog/queriesDynamo";
import { MARKETING_BLOG_TEMPLATE_ID } from "@/lib/blog/marketingBlog";
import { postMetadata, postJsonLd } from "@/lib/blog/marketingSeo";
import { JsonLd, PostCard, PostMeta, CategoryChips, ProseStyles } from "../blog-ui";

export const revalidate = 60;

type Params = { slug: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPublishedPostBySlug(MARKETING_BLOG_TEMPLATE_ID, slug);
  if (!post) return {};
  return postMetadata(post);
}

export default async function BlogPostPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const post = await getPublishedPostBySlug(MARKETING_BLOG_TEMPLATE_ID, slug);
  if (!post) notFound();

  const related = await getRelatedPosts(MARKETING_BLOG_TEMPLATE_ID, post, 3);

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-main)] selection:bg-[var(--brand)] selection:text-white transition-colors duration-300">
      <LandingNav />
      <ProseStyles />

      <section className="relative pt-24 pb-8 px-5 sm:px-6 overflow-hidden border-b border-[var(--surface-border)]">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-3xl h-[240px] bg-gradient-to-b from-[var(--brand-glow)] via-transparent to-transparent blur-3xl pointer-events-none -z-10" />

        <div className="max-w-3xl mx-auto">
          <Link
            href="/blog"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--brand)] transition-colors mb-6"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> All posts
          </Link>

          <div className="mb-4">
            <CategoryChips post={post} />
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight leading-tight mb-4">{post.title}</h1>
          <PostMeta post={post} />
        </div>
      </section>

      <article className="max-w-3xl mx-auto px-5 sm:px-6 py-10">
        {post.featuredImageUrl ? (
          // Arbitrary remote image — plain <img>, not next/image (see PostCard's note).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.featuredImageUrl}
            alt={post.featuredImageAlt ?? ""}
            className="w-full rounded-2xl border border-[var(--surface-border)] mb-10 object-cover max-h-[460px]"
          />
        ) : null}
        {/* contentHtml is sanitized at write time — lib/blog/sanitize.ts. */}
        {/* eslint-disable-next-line react/no-danger */}
        <div className="blog-prose" dangerouslySetInnerHTML={{ __html: post.contentHtml }} />
      </article>

      {related.length > 0 ? (
        <section className="max-w-5xl mx-auto px-5 sm:px-6 py-12 border-t border-[var(--surface-border)]">
          <h2 className="text-lg font-bold tracking-tight mb-6">Related posts</h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((r) => (
              <PostCard key={r.id} post={r} />
            ))}
          </div>
        </section>
      ) : null}

      <JsonLd items={postJsonLd(post)} />
    </div>
  );
}
