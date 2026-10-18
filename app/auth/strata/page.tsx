"use client";

import { useEffect, useState } from "react";
import { CharisolAuth } from "@/lib/charisolAuth";
import { markStrataConnect } from "@/lib/strataConnect";

// The small sign-in window the editor opens for "Connect Strata". It only starts the Charisol
// sign-in (silent when the person is already signed in to Charisol) and remembers WHY, so the
// Charisol callback page connects Strata instead of signing them in to Plexo again.
export default function ConnectStrataPage() {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    markStrataConnect(window.sessionStorage);
    CharisolAuth.signIn().catch(() => setFailed(true));
  }, []);

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "1.5rem", textAlign: "center", fontFamily: "system-ui, sans-serif" }}>
      {failed ? (
        <div>
          <p style={{ fontWeight: 600 }}>We couldn&apos;t open the Charisol sign-in.</p>
          <p style={{ opacity: 0.7 }}>Close this window and try connecting again.</p>
        </div>
      ) : (
        <p style={{ opacity: 0.7 }}>Taking you to Charisol to connect Strata…</p>
      )}
    </main>
  );
}
