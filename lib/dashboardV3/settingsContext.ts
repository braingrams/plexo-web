import { redirect } from "next/navigation";
import type { PlanId } from "@/lib/plan/plans";
import { auth } from "@/server/authDynamo";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { User } from "@/lib/db/coreEntities";
import type { EntityItem } from "electrodb";

type UserRecord = EntityItem<typeof User>;
import { effectivePlan } from "@/lib/plan/entitlement";
import { usesNewShell } from "../dashboardVersions/state";
import { userExperience } from "./profile";
import type { Experience } from "./nav";

type Query = Record<string, string | string[] | undefined> | undefined;

export type SettingsContext = {
  userId: string;
  organizationId: string;
  organizationName: string;
  role: string;
  experience: Experience;
  plan: PlanId;
  user: UserRecord;
  email: string;
};

/** The signed-in owner when the v3 dashboard is on for them; null when it's off (the old page then renders unchanged). */
export async function getV3SettingsContext(redirectTo: string): Promise<SettingsContext | null> {
  const session = await auth();
  if (!session?.user) redirect(`/auth/login?redirectTo=${encodeURIComponent(redirectTo)}`);
  const { data: user } = await User.get({ id: session.user.id }).go();
  if (!user || !(await usesNewShell(user))) return null;
  const org = await ensureActiveOrganization(session.user.id);
  if (org.status === "needs-choice") redirect("/choose-org");
  return {
    userId: session.user.id,
    organizationId: org.organizationId,
    organizationName: org.organizationName,
    role: org.role,
    experience: userExperience(user),
    plan: effectivePlan(user),
    user,
    email: session.user.email ?? user.email ?? "",
  };
}

/** Old settings pages: when v3 is on, send people to the matching new section (keeping ?upgrade=… etc.). */
export async function redirectIfV3(from: string, to: string, query?: Query): Promise<void> {
  const session = await auth();
  if (!session?.user) return;
  const { data: user } = await User.get({ id: session.user.id }).go();
  if (!user || !(await usesNewShell(user))) return;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) for (const x of Array.isArray(v) ? v : v === undefined ? [] : [v]) qs.append(k, x);
  redirect(qs.size ? `${to}?${qs}` : to);
}
