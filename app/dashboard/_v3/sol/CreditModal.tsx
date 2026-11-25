"use client";

import { useState } from "react";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { Check } from "lucide-react";
import { startCheckout as beginCheckout } from "@/lib/billing/clientCheckout";
import { getStripePromise } from "@/lib/stripeClientPromise";
import { OutOfCreditsOptions } from "../../_components/sol/OutOfCreditsOptions";
import { packLabel, useTopupPacks } from "../../_components/useTopupPacks";
import type { CreditInfo } from "../../sol/_components/types";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

const PACKS: Array<{ pack: "SMALL" | "MEDIUM" | "LARGE"; name: string; note: string }> = [
  { pack: "SMALL", name: "A little more", note: "Good for a few quick changes" },
  { pack: "MEDIUM", name: "A good amount", note: "Most people pick this" },
  { pack: "LARGE", name: "Plenty", note: "For building a whole site or app" },
];

/** Out of credits: pick a top-up (priced in the person's own currency) and carry on in the same chat. */
export function CreditModal({ creditInfo, returnTo, onClose }: { creditInfo: CreditInfo; returnTo: string; onClose: () => void }) {
  const packInfo = useTopupPacks();
  const [busyPack, setBusyPack] = useState<"SMALL" | "MEDIUM" | "LARGE" | null>(null);
  const [checkoutSecret, setCheckoutSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Stripe (US dollars) shows its card form here; Paystack (local currency) opens its popup and
  // the credits are added straight away — then we go back to the chat.
  async function startCheckout(pack: "SMALL" | "MEDIUM" | "LARGE") {
    setBusyPack(pack);
    setError(null);
    const result = await beginCheckout({ kind: "topup", pack, returnTo });
    setBusyPack(null);
    if (result.kind === "stripe") setCheckoutSecret(result.clientSecret);
    else if (result.kind === "paid" || result.kind === "processing") {
      setDone(result.message);
      setTimeout(() => (window.location.href = returnTo), 1500);
    } else if (result.kind === "error") setError(result.message);
  }

  return (
    <Modal
      open
      onClose={onClose}
      width={checkoutSecret ? 600 : 520}
      closeOnBackdrop={!checkoutSecret}
      title={checkoutSecret ? "Add credits" : "SOL needs more credits"}
      description={
        checkoutSecret
          ? undefined
          : `SOL needs about ${creditInfo.requiredCredits.toLocaleString()} credits to do this and you have ${creditInfo.availableCredits.toLocaleString()}. Add some and you carry on right where you left off.`
      }
    >
      {checkoutSecret ? (
        <EmbeddedCheckoutProvider stripe={getStripePromise()} options={{ clientSecret: checkoutSecret }}>
          <EmbeddedCheckout />
        </EmbeddedCheckoutProvider>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {PACKS.map(({ pack, name, note }) => (
            <button
              key={pack}
              type="button"
              disabled={busyPack !== null || !!done}
              onClick={() => void startCheckout(pack)}
              className="sol3-opt"
              style={{ justifyContent: "space-between", opacity: busyPack && busyPack !== pack ? 0.5 : 1 }}
            >
              <span>
                <span className="sol3-opt__label">{name}</span>
                <span className="sol3-opt__desc">
                  {packLabel(packInfo[pack])} · {note}
                </span>
              </span>
              <span style={{ textAlign: "right", flexShrink: 0 }}>
                <span style={{ display: "block", fontSize: 18, fontWeight: 800 }}>{packInfo[pack]?.price ?? ""}</span>
                <span className="plx-small" style={{ fontWeight: 800, color: "var(--plx-link)" }}>
                  {busyPack === pack ? "Opening…" : "Add"}
                </span>
              </span>
            </button>
          ))}
          <OutOfCreditsOptions returnTo={returnTo} />
          {error ? <p className="sol3-error" role="alert">{error}</p> : null}
          {done ? (
            <p className="sol3-notice" role="status" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Check size={18} aria-hidden /> {done}
            </p>
          ) : null}
          <p className="plx-small" style={{ margin: "4px 0 0" }}>
            You&apos;ll come straight back here once it&apos;s paid.
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button variant="ghost" onClick={onClose}>
              Not now
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
