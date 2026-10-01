import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { listPublishedPosts, getCategoryBySlug } from "@/lib/blog/queriesDynamo";
import { MARKETING_BLOG_TEMPLATE_ID } from "@/lib/blog/marketingBlog";
import { archiveMetadata, archiveJsonLd } from "@/lib/blog/marketingSeo";
import { ArchiveView } from "../../archive-view";

export const revalidate = 60;

type Params = { slug: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategoryBySlug(MARKETING_BLOG_TEMPLATE_ID, slug);
  if (!category) return {};
  return archiveMetadata(category.name, category.description ?? null, `/blog/category/${slug}`);
}

export default async function CategoryArchivePage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const category = await getCategoryBySlug(MARKETING_BLOG_TEMPLATE_ID, slug);
  if (!category) notFound();

  const { posts } = await listPublishedPosts(MARKETING_BLOG_TEMPLATE_ID, { categorySlug: slug, perPage: 60 });
  const path = `/blog/category/${slug}`;

  return (
    <ArchiveView
      kicker="Category"
      label={category.name}
      description={category.description ?? null}
      posts={posts}
      jsonLd={archiveJsonLd(path, category.name, posts)}
    />
  );
}
