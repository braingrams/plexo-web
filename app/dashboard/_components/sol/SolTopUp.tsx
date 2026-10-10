"use client";

import { useState } from "react";
import Link from "next/link";
import { OutOfCreditsCard, TopUpSheet, useCredits, type Pack } from "../../apps/_components/Credits";
import { SolIcon } from "../../sol/_components/SolIcon";

// The SOL experience every AI feature shares (lib/ai/solEngine.ts is the engine behind it):
// the same "out of credits" card with an in-page top-up, and a hand-off into the full SOL
// chat for anything bigger than a one-off edit.

/** Out of AI credits: SOL's card with the packs; paying happens in a side panel without
 *  leaving the page. `onToppedUp` runs once the credits have landed (e.g. to retry). */
export function SolOutOfCredits({ onToppedUp, onDismiss }: { onToppedUp?: () => void; onDismiss: () => void }) {
  const { credits, refresh } = useCredits();
  const [pack, setPack] = useState<Pack | null>(null);
  const returnTo = typeof window !== "undefined" ? window.location.pathname + window.location.search : "/dashboard";
  return (
    <>
      <OutOfCreditsCard onPick={setPack} onDismiss={onDismiss} />
      {pack && (
        <TopUpSheet
          pack={pack}
          returnTo={returnTo}
          startingCredits={credits}
          onClose={() => setPack(null)}
          onDone={() => {
            setPack(null);
            void refresh();
            onToppedUp?.();
          }}
        />
      )}
    </>
  );
}

/** "Bigger change? Continue with SOL" — opens the SOL chat with the request ready to send. */
export function SolHandoff({ draft, label = "Bigger change? Continue with SOL" }: { draft: string; label?: string }) {
  const href = `/dashboard/sol?new=1${draft.trim() ? `&draft=${encodeURIComponent(draft.trim().slice(0, 2000))}` : ""}`;
  return (
    <Link href={href} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.78rem", color: "var(--brand-light, #a78bfa)", textDecoration: "none" }}>
      <SolIcon size={14} /> {label} →
    </Link>
  );
}

export { SolIcon };
