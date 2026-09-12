"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { OrgSwitcher } from "../../_components/TeamHeaderControls";

/**
 * The org switcher + sign-out that every other Plexo view already has (see
 * dashboard-shell-classic.tsx's own sidebar footer) — SOL's own chrome fully replaces the
 * normal dashboard shell, so without this a user stuck inside SOL would have no way to
 * switch organizations or sign out without first leaving back to the Plexo view.
 */
export function SolAccountFooter({ organizationName }: { organizationName: string }) {
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await authClient.signOut();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div style={{ padding: "0.6rem", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: "0.4rem" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <OrgSwitcher organizationName={organizationName} anchor="left" />
      </div>
      <button
        type="button"
        onClick={() => void handleSignOut()}
        disabled={signingOut}
        title="Sign out"
        aria-label="Sign out"
        style={{
          width: 32,
          height: 32,
          borderRadius: 9,
          border: "none",
          background: "none",
          color: signingOut ? "rgba(240,242,255,0.25)" : "rgba(240,242,255,0.45)",
          cursor: signingOut ? "not-allowed" : "pointer",
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
        }}
        className="sol-nav-item"
      >
        <LogOut size={15} />
      </button>
    </div>
  );
}
