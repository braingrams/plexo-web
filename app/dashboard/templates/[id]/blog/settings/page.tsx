import { BlogSite, BlogCategory, BlogTag, BlogAuthor, Template } from "@/lib/db/contentEntities";
import { requireBlogSiteAccess } from "@/lib/blog/pageAuthDynamo";
import { hasBlogMarker } from "@/lib/pub/blogLayoutRender";
import { BlogSettingsClient } from "./BlogSettingsClient";

export default async function BlogSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireBlogSiteAccess(id, `/dashboard/templates/${id}/blog/settings`);

  const [{ data: site }, { data: categories }, { data: tags }, { data: authors }] = await Promise.all([
    BlogSite.get({ templateId: access.templateId }).go(),
    BlogCategory.query.primary({ templateId: access.templateId }).go(),
    BlogTag.query.primary({ templateId: access.templateId }).go(),
    BlogAuthor.query.primary({ templateId: access.templateId }).go(),
  ]);
  categories.sort((a, b) => a.name.localeCompare(b.name));
  tags.sort((a, b) => a.name.localeCompare(b.name));
  authors.sort((a, b) => a.name.localeCompare(b.name));

  const [postLayoutTemplate, listingLayoutTemplate] = await Promise.all([
    site?.postLayoutTemplateId ? Template.get({ id: site.postLayoutTemplateId }).go() : null,
    site?.listingLayoutTemplateId ? Template.get({ id: site.listingLayoutTemplateId }).go() : null,
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
        postLayoutTemplate?.data
          ? { templateId: postLayoutTemplate.data.id, ready: hasBlogMarker(postLayoutTemplate.data.compiledHtml, "content") }
          : null
      }
      listingLayout={
        listingLayoutTemplate?.data
          ? { templateId: listingLayoutTemplate.data.id, ready: hasBlogMarker(listingLayoutTemplate.data.compiledHtml, "postList") }
          : null
      }
      categories={categories}
      tags={tags}
      authors={authors}
    />
  );
}
