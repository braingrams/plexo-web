"use client";

import { LayoutModeProvider, useLayoutMode, type LayoutMode } from "./layout-mode-context";
import { DashboardShellClassic } from "./dashboard-shell-classic";
import { DashboardShellModern } from "./dashboard-shell-modern";

type Props = {
  children: React.ReactNode;
  userName: string;
  userEmail: string;
  initialLayoutMode: LayoutMode;
};

export function DashboardShell({ children, userName, userEmail, initialLayoutMode }: Props) {
  return (
    <LayoutModeProvider initialMode={initialLayoutMode}>
      <ShellSwitcher userName={userName} userEmail={userEmail}>
        {children}
      </ShellSwitcher>
    </LayoutModeProvider>
  );
}

function ShellSwitcher({
  children,
  userName,
  userEmail,
}: {
  children: React.ReactNode;
  userName: string;
  userEmail: string;
}) {
  const { mode } = useLayoutMode();

  if (mode === "MODERN") {
    return (
      <DashboardShellModern userName={userName} userEmail={userEmail}>
        {children}
      </DashboardShellModern>
    );
  }

  return (
    <DashboardShellClassic userName={userName} userEmail={userEmail}>
      {children}
    </DashboardShellClassic>
  );
}
