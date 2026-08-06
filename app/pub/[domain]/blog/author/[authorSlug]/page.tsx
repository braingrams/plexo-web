import type { Metadata } from "next";
import { resolveBlogSite } from "@/lib/pub/resolveSite";
import { BlogArchivePage, buildArchiveMetadata } from "@/lib/pub/blogArchivePage";

export const revalidate = 60;

type Params = { domain: string; authorSlug: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { domain, authorSlug } = await params;
  const site = await resolveBlogSite(decodeURIComponent(domain));
  return buildArchiveMetadata(domain, site, "author", authorSlug);
}

export default async function AuthorArchivePage({ params }: { params: Promise<Params> }) {
  const { domain, authorSlug } = await params;
  const site = await resolveBlogSite(decodeURIComponent(domain));
  return <BlogArchivePage domain={domain} site={site} kind="author" slug={authorSlug} page={1} />;
}
