import { redirect } from "next/navigation";
import { auth } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { usesNewShell } from "../dashboardVersions/state";

/** Old page, new home: sends the person to `to` only when their dashboard is the v3 one. */
export async function redirectIfV3(to: string): Promise<void> {
  const session = await auth();
  if (!session?.user) return;
  const { data: user } = await User.get({ id: session.user.id }).go();
  if (user && (await usesNewShell(user))) redirect(to);
}
