import { redirect } from "next/navigation";
import { Figtree } from "next/font/google";
import { auth } from "@/server/authDynamo";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { Template } from "@/lib/db/contentEntities";
import { ProjectBuild } from "@/lib/db/projectEntities";
import { previewUrl } from "@/lib/projects/previewHost";
import { AppsHome, type HomeApp } from "./_components/AppsHome";

export const dynamic = "force-dynamic";

const figtree = Figtree({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], display: "swap" });

/** Apps: pick up where you left off, or answer three questions to start a new one. */
export default async function AppsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await auth();
  if (!session?.user) redirect("/auth/login?redirectTo=/dashboard/apps");
  const org = await ensureActiveOrganization(session.user.id);
  if (org.status === "needs-choice") redirect("/choose-org");
  const query = await searchParams;

  const { data } = await Template.query.byOrg({ organizationId: org.organizationId }).go({ pages: "all" });
  const projects = data
    .filter((t) => t.sourceType === "REACT_PROJECT" && !t.parentId)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));

  // "Needs a fix": the app's newest build didn't work.
  const apps: HomeApp[] = await Promise.all(
    projects.map(async (t) => {
      const { data: latest } = await ProjectBuild.query.byTemplate({ templateId: t.id }).go({ order: "desc", limit: 1 }).catch(() => ({ data: [] as Array<{ status: string }> }));
      return {
        id: t.id,
        name: t.name,
        previewUrl: t.previewHost && t.latestBuildId ? previewUrl(t.previewHost) : null,
        published: !!t.liveBuildId,
        updatedAt: t.updatedAt ?? null,
        needsFix: latest[0]?.status === "FAILED",
      };
    }),
  );

  return <AppsHome apps={apps} userName={session.user.name?.split(" ")[0] ?? null} showAll={query.view === "all"} fontClassName={figtree.className} />;
}
