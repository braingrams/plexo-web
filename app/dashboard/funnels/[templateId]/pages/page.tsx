import { auth } from "@/server/authDynamo";
import { LmsPage } from "@/lib/db/contentEntities";
import { User } from "@/lib/db/coreEntities";
import { PagesBuilderClient } from "./PagesBuilderClient";

export default async function FunnelPagesRoute({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const session = await auth();

  const [{ data: pages }, { data: user }] = await Promise.all([
    LmsPage.query.byOrder({ templateId }).go({ pages: "all" }),
    session?.user ? User.get({ id: session.user.id }).go() : Promise.resolve({ data: null }),
  ]);

  return <PagesBuilderClient templateId={templateId} initialPages={pages} builderLevel={user?.funnelBuilderLevel ?? "INTERMEDIATE"} />;
}
