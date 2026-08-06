import type { Metadata } from "next";
import { resolveBlogSite } from "@/lib/pub/resolveSite";
import { BlogArchivePage, buildArchiveMetadata } from "@/lib/pub/blogArchivePage";

export const revalidate = 60;

type Params = { domain: string; tagSlug: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { domain, tagSlug } = await params;
  const site = await resolveBlogSite(decodeURIComponent(domain));
  return buildArchiveMetadata(domain, site, "tag", tagSlug);
}

export default async function TagArchivePage({ params }: { params: Promise<Params> }) {
  const { domain, tagSlug } = await params;
  const site = await resolveBlogSite(decodeURIComponent(domain));
  return <BlogArchivePage domain={domain} site={site} kind="tag" slug={tagSlug} page={1} />;
}
