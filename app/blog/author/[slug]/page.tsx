import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { listPublishedPosts, getAuthorBySlug } from "@/lib/blog/queriesDynamo";
import { MARKETING_BLOG_TEMPLATE_ID } from "@/lib/blog/marketingBlog";
import { archiveMetadata, archiveJsonLd } from "@/lib/blog/marketingSeo";
import { ArchiveView } from "../../archive-view";

export const revalidate = 60;

type Params = { slug: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const author = await getAuthorBySlug(MARKETING_BLOG_TEMPLATE_ID, slug);
  if (!author) return {};
  return archiveMetadata(author.name, author.bio ?? null, `/blog/author/${slug}`);
}

export default async function AuthorArchivePage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const author = await getAuthorBySlug(MARKETING_BLOG_TEMPLATE_ID, slug);
  if (!author) notFound();

  const { posts } = await listPublishedPosts(MARKETING_BLOG_TEMPLATE_ID, { authorSlug: slug, perPage: 60 });
  const path = `/blog/author/${slug}`;

  return (
    <ArchiveView
      kicker="Author"
      label={author.name}
      description={author.bio ?? null}
      posts={posts}
      jsonLd={archiveJsonLd(path, author.name, posts)}
    />
  );
}
