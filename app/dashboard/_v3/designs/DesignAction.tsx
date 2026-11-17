"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { Eye } from "lucide-react";
import { getStripePromise } from "@/lib/stripeClientPromise";
import { afterUseHref } from "@/lib/dashboardV3/designs";
import { Button, Modal, Notice } from "../ui";
import { DesignPreview } from "./DesignPreview";

/** Get, buy or use a design. Same steps as before: claim or pay, make your own copy, then open it. */
export function DesignAction({ designId, kind, isFree, owned, autoUse }: { designId: string; kind: string; isFree: boolean; owned: boolean; autoUse: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(autoUse);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const fired = useRef(false);

  async function makeMyCopy() {
    const res = await fetch(`/api/v1/marketplace/templates/${designId}/use`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "We could not make your copy. Please try again.");
      setPending(false);
      return;
    }
    router.push(afterUseHref(data.template.id, kind));
  }

  useEffect(() => {
    if (!autoUse || !owned || fired.current) return;
    fired.current = true;
    void makeMyCopy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoUse, owned]);

  async function onClick() {
    setError(null);
    setPending(true);
    if (owned) return makeMyCopy();
    const res = await fetch(`/api/v1/marketplace/templates/${designId}/purchase`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? (isFree ? "We could not add this design. Please try again." : "We could not start the payment. Please try again."));
      setPending(false);
      return;
    }
    if (data.clientSecret) {
      setSecret(data.clientSecret);
      setPending(false);
      return;
    }
    // Free (or already yours): straight to your own copy.
    await makeMyCopy();
  }

  return (
    <div className="plx-dzdet__side" style={{ gap: 12 }}>
      {error ? <Notice kind="error" title="That did not work">{error}</Notice> : null}
      <div className="plx-dzdet__acts">
        <Button size="lg" onClick={onClick} loading={pending} loadingLabel="Getting your copy ready">
          {owned ? "Use this design" : isFree ? "Use it for free" : "Buy this design"}
        </Button>
        <Button size="lg" variant="secondary" leftIcon={<Eye size={18} aria-hidden />} onClick={() => setPreviewing(true)}>
          Full-size preview
        </Button>
      </div>
      <Modal open={secret !== null} onClose={() => setSecret(null)} title="Pay for this design" width={520}>
        {secret ? (
          <div className="plx-dzcheckout">
            <EmbeddedCheckoutProvider stripe={getStripePromise()} options={{ clientSecret: secret }}>
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          </div>
        ) : null}
      </Modal>
      <DesignPreview designId={previewing ? designId : null} onClose={() => setPreviewing(false)} />
    </div>
  );
}
