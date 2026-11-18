import { auth } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { usesNewShell } from "@/lib/dashboardVersions/state";
import { EditorFrame } from "../_components/EditorTheme";

/** The apps home and every app's editor share one frame: Plexo's own brand in the new dashboard. */
export default async function AppEditorsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const { data: user } = session?.user ? await User.get({ id: session.user.id }).go() : { data: null };
  return <EditorFrame v3={await usesNewShell(user)}>{children}</EditorFrame>;
}
