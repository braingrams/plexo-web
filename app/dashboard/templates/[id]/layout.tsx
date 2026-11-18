import { auth } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { usesNewShell } from "@/lib/dashboardVersions/state";
import { userExperience } from "@/lib/dashboardV3/profile";
import { EditorFrame } from "../../_components/EditorTheme";

/** Every editor for a site (page, blog, layout, raw code) shares one frame: Plexo's own brand in the new dashboard. */
export default async function SiteEditorsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const { data: user } = session?.user ? await User.get({ id: session.user.id }).go() : { data: null };
  const v3 = await usesNewShell(user);
  return <EditorFrame v3={v3} beginner={v3 && userExperience(user) === "beginner"}>{children}</EditorFrame>;
}
