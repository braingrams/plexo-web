"use client";

import { LayoutModeProvider, useLayoutMode, type LayoutMode } from "./layout-mode-context";
import { DashboardShellClassic } from "./dashboard-shell-classic";
import { DashboardShellModern } from "./dashboard-shell-modern";

/** Resolved by lib/subscription.ts's getOrgBrand — undefined when the org isn't
 * white-label-entitled or has set no branding, in which case shells fall back to Plexo. */
export type OrgBranding = { name: string; logoUrl?: string; color?: string };

type Props = {
  children: React.ReactNode;
  userName: string;
  userEmail: string;
  initialLayoutMode: LayoutMode;
  organizationName: string;
  orgBranding?: OrgBranding;
};

export function DashboardShell({ children, userName, userEmail, initialLayoutMode, organizationName, orgBranding }: Props) {
  return (
    <LayoutModeProvider initialMode={initialLayoutMode}>
      <ShellSwitcher userName={userName} userEmail={userEmail} organizationName={organizationName} orgBranding={orgBranding}>
        {children}
      </ShellSwitcher>
    </LayoutModeProvider>
  );
}

function ShellSwitcher({
  children,
  userName,
  userEmail,
  organizationName,
  orgBranding,
}: {
  children: React.ReactNode;
  userName: string;
  userEmail: string;
  organizationName: string;
  orgBranding?: OrgBranding;
}) {
  const { mode } = useLayoutMode();

  if (mode === "MODERN") {
    return (
      <DashboardShellModern userName={userName} userEmail={userEmail} organizationName={organizationName} orgBranding={orgBranding}>
        {children}
      </DashboardShellModern>
    );
  }

  return (
    <DashboardShellClassic userName={userName} userEmail={userEmail} organizationName={organizationName} orgBranding={orgBranding}>
      {children}
    </DashboardShellClassic>
  );
}
