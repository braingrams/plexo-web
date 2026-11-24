import { NextRequest, NextResponse } from "next/server";
import { resolveRedirectAdmin } from "@/lib/blog/redirectsDynamo";
import { BlogRedirect, PublishedDomain, Template } from "@/lib/db/contentEntities";
import { buildPageChoices } from "@/lib/dashboardV3/pickPage";
import { findBrokenLinks } from "@/lib/redirects/linkAudit";

/** GET: links on the site's pages that go to an address that isn't a page, blog address or redirect. Reads what is already saved; nothing is fetched from the internet. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id: templateId } = await context.params;
  const resolved = await resolveRedirectAdmin(request, templateId);
  if (resolved.error) return resolved.error;
  const { organizationId } = resolved.context;

  const [{ data: root }, { data: redirects }, { data: domains }] = await Promise.all([
    Template.get({ id: templateId }).go(),
    BlogRedirect.query.primary({ templateId }).go({ pages: "all" }),
    PublishedDomain.query.primary({ templateId }).go({ pages: "all" }),
  ]);
  const { data: kids } = await Template.query.byParent({ parentId: templateId }).go({ pages: "all" }).catch(() => ({ data: [] as NonNullable<typeof root>[] }));
  const all = [root, ...kids].filter((t): t is NonNullable<typeof root> => !!t && t.organizationId === organizationId);
  const choices = buildPageChoices(all.map((t) => ({ id: t.id, name: t.name, slug: t.slug, parentId: t.parentId, order: t.order, sourceType: t.sourceType })), templateId);
  const htmlById = new Map(all.map((t) => [t.id, t.compiledHtml ?? ""]));
  const pages = choices.slice(0, 120).map((c) => ({ name: c.label, path: c.path, html: htmlById.get(c.id) ?? "" }));
  const broken = findBrokenLinks(pages, {
    redirects: redirects.map((r) => r.fromPath),
    servedPrefixes: ["/blog", "/store", "/shop", "/cart", "/checkout", "/order", "/_blog", "/__plexo"],
    host: domains[0]?.domain ?? null,
  });
  return NextResponse.json({ checkedPages: pages.length, broken: broken.slice(0, 100) });
}
