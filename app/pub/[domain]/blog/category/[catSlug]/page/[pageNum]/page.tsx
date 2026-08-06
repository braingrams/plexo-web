import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveBlogSite } from "@/lib/pub/resolveSite";
import { BlogArchivePage, buildArchiveMetadata } from "@/lib/pub/blogArchivePage";

export const revalidate = 60;

type Params = { domain: string; catSlug: string; pageNum: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { domain, catSlug } = await params;
  const site = await resolveBlogSite(decodeURIComponent(domain));
  return buildArchiveMetadata(domain, site, "category", catSlug);
}

export default async function CategoryArchivePaginatedPage({ params }: { params: Promise<Params> }) {
  const { domain, catSlug, pageNum } = await params;
  const page = Number.parseInt(pageNum, 10);
  if (!Number.isInteger(page) || page < 2) notFound(); // page 1 canonically lives at the un-paginated URL
  const site = await resolveBlogSite(decodeURIComponent(domain));
  return <BlogArchivePage domain={domain} site={site} kind="category" slug={catSlug} page={page} />;
}
