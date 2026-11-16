"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button } from "@/app/auth/_kit/ui";

export function AcceptInviteClient({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAccept() {
    setPending("accept");
    setError(null);
    try {
      // /api/org/invite/[id]/accept already sets the active-org cookie on success
      // (see server/orgDynamo.ts's setActiveOrganizationCookie) — no separate "set
      // active" call needed here, unlike better-auth's two-step client flow.
      const res = await fetch(`/api/org/invite/${invitationId}/accept`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? "Couldn't accept this invitation.");
      }
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't accept this invitation. Try again.");
      setPending(null);
    }
  }

  async function handleDecline() {
    setPending("decline");
    setError(null);
    try {
      const res = await fetch(`/api/org/invite/${invitationId}/reject`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? "Couldn't decline this invitation.");
      }
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't decline this invitation.");
      setPending(null);
    }
  }

  return (
    <div className="ax-stack">
      {error && <Alert tone="error">{error}</Alert>}
      <div className="ax-row">
        <Button type="button" onClick={handleAccept} loading={pending === "accept"} disabled={pending !== null}>
          {pending === "accept" ? "Joining…" : "Accept invitation"}
        </Button>
        <Button type="button" variant="secondary" onClick={handleDecline} loading={pending === "decline"} disabled={pending !== null}>
          {pending === "decline" ? "Declining…" : "Decline"}
        </Button>
      </div>
    </div>
  );
}
