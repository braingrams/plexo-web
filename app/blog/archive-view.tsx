import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { LandingNav } from "../landing-nav";
import type { BlogPostCard } from "@/lib/blog/queriesDynamo";
import { JsonLd, PostCard } from "./blog-ui";

// Shared chrome for the category / tag / author archive pages — same dark hero + card grid
// as the /blog index, parameterized by the archive's label + kicker.
export function ArchiveView({
  kicker,
  label,
  description,
  posts,
  jsonLd,
}: {
  kicker: string;
  label: string;
  description?: string | null;
  posts: BlogPostCard[];
  jsonLd: unknown[];
}) {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-main)] selection:bg-[var(--brand)] selection:text-white transition-colors duration-300">
      <LandingNav />

      <section className="relative pt-24 pb-10 px-5 sm:px-6 overflow-hidden border-b border-[var(--surface-border)]">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-5xl h-[280px] bg-gradient-to-b from-[var(--brand-glow)] via-transparent to-transparent blur-3xl pointer-events-none -z-10" />

        <div className="max-w-2xl mx-auto flex flex-col items-center text-center">
          <Link
            href="/blog"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--brand)] transition-colors mb-4"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> All posts
          </Link>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--brand)] mb-2">{kicker}</p>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight mb-3">{label}</h1>
          {description ? <p className="text-sm text-[var(--text-muted)] max-w-md leading-relaxed">{description}</p> : null}
        </div>
      </section>

      <main className="max-w-5xl mx-auto px-5 sm:px-6 py-10">
        {posts.length === 0 ? (
          <p className="text-center text-sm text-[var(--text-muted)] py-24">No posts here yet.</p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        )}
      </main>

      <JsonLd items={jsonLd} />
    </div>
  );
}
