import { loadHubPages, loadHubSite, requireHubContext } from "@/lib/dashboardV3/hubData";
import { parseStep, parseTopic, walkPages } from "@/lib/dashboardV3/wordsFlow";
import { WordsGuide } from "../../../_v3/hub/WordsGuide";
import { editHrefFor } from "@/lib/dashboardV3/hubPaths";

export const dynamic = "force-dynamic";
export const metadata = { title: "Change the words" };

/** A guided walk through every page: look at it, change it right on the page if you want, then next. */
export default async function WordsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const query = await searchParams;
  const ctx = await requireHubContext(`/dashboard/sites/${id}/words`);
  const site = await loadHubSite(ctx.organizationId, id);
  const pages = walkPages(await loadHubPages(ctx.organizationId, id)).map((p) => ({ id: p.id, name: p.name, isRoot: p.isRoot, sourceType: p.sourceType, editHref: editHrefFor(p.id, p.sourceType) }));
  const topic = parseTopic(query.for);
  return <WordsGuide siteId={id} siteName={site.name} pages={pages} topic={topic} step={parseStep(query.step, pages.length)} />;
}
