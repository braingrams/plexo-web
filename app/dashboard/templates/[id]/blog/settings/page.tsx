import { prisma } from "@/server/prisma";
import { requireBlogSiteAccess } from "@/lib/blog/pageAuth";
import { hasBlogMarker } from "@/lib/pub/blogLayoutRender";
import { BlogSettingsClient } from "./BlogSettingsClient";

export default async function BlogSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireBlogSiteAccess(id, `/dashboard/templates/${id}/blog/settings`);

  const [site, categories, tags, authors] = await Promise.all([
    prisma.blogSite.findUnique({
      where: { templateId: access.templateId },
      include: {
        postLayoutTemplate: { select: { id: true, compiledHtml: true } },
        listingLayoutTemplate: { select: { id: true, compiledHtml: true } },
      },
    }),
    prisma.blogCategory.findMany({ where: { templateId: access.templateId }, orderBy: { name: "asc" } }),
    prisma.blogTag.findMany({ where: { templateId: access.templateId }, orderBy: { name: "asc" } }),
    prisma.blogAuthor.findMany({ where: { templateId: access.templateId }, orderBy: { name: "asc" } }),
  ]);

  return (
    <BlogSettingsClient
      templateId={access.templateId}
      initialSite={{
        enabled: site?.enabled ?? false,
        title: site?.title ?? "Blog",
        description: site?.description ?? "",
        postsPerPage: site?.postsPerPage ?? 10,
        showOnHomepage: site?.showOnHomepage ?? false,
        accentColor: site?.accentColor ?? "",
        fontPreset: site?.fontPreset ?? "sans",
        logoUrl: site?.logoUrl ?? "",
        headerImageUrl: site?.headerImageUrl ?? "",
        commentsEnabled: site?.commentsEnabled ?? true,
      }}
      postLayout={
        site?.postLayoutTemplate
          ? { templateId: site.postLayoutTemplate.id, ready: hasBlogMarker(site.postLayoutTemplate.compiledHtml, "content") }
          : null
      }
      listingLayout={
        site?.listingLayoutTemplate
          ? { templateId: site.listingLayoutTemplate.id, ready: hasBlogMarker(site.listingLayoutTemplate.compiledHtml, "postList") }
          : null
      }
      categories={categories}
      tags={tags}
      authors={authors}
    />
  );
}
