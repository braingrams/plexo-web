"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function PurchaseAction({
  templateId,
  isFree,
  owned,
  isLoggedIn,
  autoUse = false,
}: {
  templateId: string;
  isFree: boolean;
  owned: boolean;
  isLoggedIn: boolean;
  /** Auto-continue into the editor once, right after a successful Stripe redirect back here. */
  autoUse?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(autoUse);
  const [error, setError] = useState<string | null>(null);
  const autoUseFired = useRef(false);

  async function useTemplate() {
    const res = await fetch(`/api/v1/marketplace/templates/${templateId}/use`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Failed to create your copy.");
      setPending(false);
      return;
    }
    router.push(`/dashboard/templates/${data.template.id}`);
  }

  useEffect(() => {
    if (!autoUse || !owned || autoUseFired.current) return;
    autoUseFired.current = true;
    void useTemplate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoUse, owned]);

  async function handleClick() {
    setError(null);

    if (!isLoggedIn) {
      router.push(`/auth/login?redirectTo=${encodeURIComponent(`/marketplace/${templateId}`)}`);
      return;
    }

    setPending(true);

    if (owned) {
      await useTemplate();
      return;
    }

    if (isFree) {
      const res = await fetch(`/api/v1/marketplace/templates/${templateId}/purchase`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to claim template.");
        setPending(false);
        return;
      }
      await useTemplate();
      return;
    }

    const res = await fetch(`/api/v1/marketplace/templates/${templateId}/purchase`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Failed to start checkout.");
      setPending(false);
      return;
    }
    if (data.url) {
      window.location.href = data.url;
      return;
    }
    // alreadyOwned raced in between page load and click — just use it.
    await useTemplate();
  }

  return (
    <div>
      {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
      <button
        onClick={handleClick}
        disabled={pending}
        className="rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
      >
        {pending ? "Working…" : owned ? "Use this template" : isFree ? "Get this template" : "Buy this template"}
      </button>
    </div>
  );
}
