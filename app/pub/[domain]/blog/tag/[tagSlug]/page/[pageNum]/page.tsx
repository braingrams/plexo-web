import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveBlogSite } from "@/lib/pub/resolveSite";
import { BlogArchivePage, buildArchiveMetadata } from "@/lib/pub/blogArchivePage";

export const revalidate = 60;

type Params = { domain: string; tagSlug: string; pageNum: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { domain, tagSlug } = await params;
  const site = await resolveBlogSite(decodeURIComponent(domain));
  return buildArchiveMetadata(domain, site, "tag", tagSlug);
}

export default async function TagArchivePaginatedPage({ params }: { params: Promise<Params> }) {
  const { domain, tagSlug, pageNum } = await params;
  const page = Number.parseInt(pageNum, 10);
  if (!Number.isInteger(page) || page < 2) notFound();
  const site = await resolveBlogSite(decodeURIComponent(domain));
  return <BlogArchivePage domain={domain} site={site} kind="tag" slug={tagSlug} page={page} />;
}
