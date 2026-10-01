import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { listPublishedPosts, getTagBySlug } from "@/lib/blog/queriesDynamo";
import { MARKETING_BLOG_TEMPLATE_ID } from "@/lib/blog/marketingBlog";
import { archiveMetadata, archiveJsonLd } from "@/lib/blog/marketingSeo";
import { ArchiveView } from "../../archive-view";

export const revalidate = 60;

type Params = { slug: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const tag = await getTagBySlug(MARKETING_BLOG_TEMPLATE_ID, slug);
  if (!tag) return {};
  return archiveMetadata(`#${tag.name}`, null, `/blog/tag/${slug}`);
}

export default async function TagArchivePage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const tag = await getTagBySlug(MARKETING_BLOG_TEMPLATE_ID, slug);
  if (!tag) notFound();

  const { posts } = await listPublishedPosts(MARKETING_BLOG_TEMPLATE_ID, { tagSlug: slug, perPage: 60 });
  const path = `/blog/tag/${slug}`;

  return (
    <ArchiveView
      kicker="Tag"
      label={`#${tag.name}`}
      posts={posts}
      jsonLd={archiveJsonLd(path, `#${tag.name}`, posts)}
    />
  );
}
