import { auth } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { usesNewShell } from "@/lib/dashboardVersions/state";
import { EditorFrame } from "../../_components/EditorTheme";

/** Every editor for a site (page, blog, layout, raw code) shares one frame: Plexo's own brand in the new dashboard. */
export default async function SiteEditorsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const { data: user } = session?.user ? await User.get({ id: session.user.id }).go() : { data: null };
  return <EditorFrame v3={await usesNewShell(user)}>{children}</EditorFrame>;
}
