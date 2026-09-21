import { auth } from "@/server/authDynamo";
import { ensureActiveOrganization, getOrgBrandDynamo } from "@/server/orgDynamo";
import { SolShell } from "./_components/SolShell";

/**
 * Shared chrome for every route under /dashboard/sol (the conversation sidebar + the
 * one-shot entrance reveal) — a server-component pass-through into the client SolShell.
 * Auth itself already happened one level up in app/dashboard/layout.tsx (this doesn't
 * re-check/redirect on it), but the organization NAME specifically isn't threaded down
 * through that parent layout's props, and SOL's own sidebar needs it for its own org
 * switcher/sign-out footer (SOL fully replaces the normal dashboard chrome, so without
 * this a user has no way to switch orgs or sign out without first leaving SOL) — resolved
 * again here the same way the parent layout does, rather than piping an extra prop through
 * a layout this doesn't otherwise need to touch.
 * Living at the layout level (rather than something each page renders itself) is what
 * keeps SolShell mounted across /dashboard/sol/[a] <-> [b] navigation — see SolShell's own
 * comment for why that matters.
 */
export default async function SolLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const orgResolution = session?.user ? await ensureActiveOrganization(session.user.id) : null;
  const organizationName = orgResolution?.status === "resolved" ? orgResolution.organizationName : "Workspace";
  // SOL fully replaces the normal dashboard chrome (see this file's own top comment), so
  // its own Plexo wordmark/icon needs the org's white-label branding threaded down
  // explicitly too — it was never wired here at all before, unlike the ordinary dashboard
  // shells, so a whitelabeled org's SOL sidebar always showed the literal Plexo mark.
  const orgBranding = orgResolution?.status === "resolved" ? await getOrgBrandDynamo(orgResolution.organizationId) : undefined;

  return (
    <SolShell organizationName={organizationName} orgBranding={orgBranding}>
      {children}
    </SolShell>
  );
}
