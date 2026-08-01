"use client";

import { LayoutModeProvider, useLayoutMode, type LayoutMode } from "./layout-mode-context";
import { DashboardShellClassic } from "./dashboard-shell-classic";
import { DashboardShellModern } from "./dashboard-shell-modern";

type Props = {
  children: React.ReactNode;
  userName: string;
  userEmail: string;
  initialLayoutMode: LayoutMode;
  organizationName: string;
};

export function DashboardShell({ children, userName, userEmail, initialLayoutMode, organizationName }: Props) {
  return (
    <LayoutModeProvider initialMode={initialLayoutMode}>
      <ShellSwitcher userName={userName} userEmail={userEmail} organizationName={organizationName}>
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
}: {
  children: React.ReactNode;
  userName: string;
  userEmail: string;
  organizationName: string;
}) {
  const { mode } = useLayoutMode();

  if (mode === "MODERN") {
    return (
      <DashboardShellModern userName={userName} userEmail={userEmail} organizationName={organizationName}>
        {children}
      </DashboardShellModern>
    );
  }

  return (
    <DashboardShellClassic userName={userName} userEmail={userEmail} organizationName={organizationName}>
      {children}
    </DashboardShellClassic>
  );
}
