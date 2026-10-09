import { redirect } from "next/navigation";
import { auth } from "@/server/authDynamo";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { Template } from "@/lib/db/contentEntities";
import { previewUrl } from "@/lib/projects/previewHost";
import { AppsHome } from "./_components/AppsHome";

export const dynamic = "force-dynamic";

/** Apps: describe what to build, or open one you've started. */
export default async function AppsPage() {
  const session = await auth();
  if (!session?.user) redirect("/auth/login?redirectTo=/dashboard/apps");
  const org = await ensureActiveOrganization(session.user.id);
  if (org.status === "needs-choice") redirect("/choose-org");

  const { data } = await Template.query.byOrg({ organizationId: org.organizationId }).go({ pages: "all", order: "desc" });
  const apps = data
    .filter((t) => t.sourceType === "REACT_PROJECT" && !t.parentId)
    .map((t) => ({ id: t.id, name: t.name, previewUrl: t.previewHost ? previewUrl(t.previewHost) : null, published: !!t.liveBuildId, updatedAt: t.updatedAt ?? null }));

  return <AppsHome apps={apps} userName={session.user.name?.split(" ")[0] ?? null} />;
}
