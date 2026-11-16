import { loadV3ShellData } from "@/lib/dashboardV3/loadShell";
import type { PlanId } from "@/lib/plan/plans";
import type { OrgBranding } from "../dashboard-shell";
import { LayoutModeProvider } from "../layout-mode-context";
import { NewSiteProvider } from "../_components/NewSiteModal";
import { VersionProvider, type VersionUiData } from "../_versions/VersionUi";
import { V3Root } from "./V3Root";
import { V3Shell } from "./shell/V3Shell";

type Props = {
  user: { id: string; name: string; email: string; image?: string | null; experience?: string | null; buildProfile?: unknown; themePreference?: string | null; tourState?: unknown };
  organizationId: string;
  orgBranding?: OrgBranding;
  plan: PlanId;
  versions: VersionUiData;
  children: React.ReactNode;
};

/**
 * The v3 dashboard frame (DASHBOARD_V3 on). Existing pages still render inside it — they keep
 * their LayoutMode / NewSite providers — until each section is rebuilt for v3.
 */
export async function V3DashboardLayout({ user, organizationId, orgBranding, plan, versions, children }: Props) {
  const data = await loadV3ShellData(user, organizationId);
  return (
    <V3Root themePreference={data.themePreference} brandColor={orgBranding?.color}>
      <LayoutModeProvider initialMode="CLASSIC">
        <VersionProvider data={versions}>
        <NewSiteProvider plan={plan}>
          <V3Shell
            user={{ name: user.name, email: user.email, image: user.image }}
            experience={data.experience}
            nav={data.nav}
            sites={data.sites}
            currentSiteId={data.currentSite?.id ?? null}
            orgBranding={orgBranding}
            tourState={data.tourState}
          >
            {children}
          </V3Shell>
        </NewSiteProvider>
        </VersionProvider>
      </LayoutModeProvider>
    </V3Root>
  );
}
