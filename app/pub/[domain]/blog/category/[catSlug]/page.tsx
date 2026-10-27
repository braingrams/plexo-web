import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { resolveBlogSite } from "@/lib/pub/resolveSiteDynamo";
import { BlogArchivePage, buildArchiveMetadata } from "@/lib/pub/blogArchivePageDynamo";

export const revalidate = 60;

type Params = { domain: string; catSlug: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { domain, catSlug } = await params;
  const site = await resolveBlogSite(decodeURIComponent(domain));
  return buildArchiveMetadata(domain, site, "category", catSlug);
}

export default async function CategoryArchivePage({ params }: { params: Promise<Params> }) {
  const { domain, catSlug } = await params;
  const site = await resolveBlogSite(decodeURIComponent(domain));
  if (site.status === "deployed") redirect(`/_dp/blog/category/${catSlug}`);
  return <BlogArchivePage domain={domain} site={site} kind="category" slug={catSlug} page={1} />;
}
