import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { resolveBlogSite } from "@/lib/pub/resolveSiteDynamo";
import { BlogArchivePage, buildArchiveMetadata } from "@/lib/pub/blogArchivePageDynamo";

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
  if (site.status === "deployed") redirect(`/_dp/blog/author/${authorSlug}`);
  return <BlogArchivePage domain={domain} site={site} kind="author" slug={authorSlug} page={1} />;
}
