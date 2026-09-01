"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
    <div>
      <div className="flex gap-3 justify-center">
        <button
          onClick={handleAccept}
          disabled={pending !== null}
          className="bg-gradient-to-br from-purple-500 to-purple-700 text-white font-bold text-sm px-6 py-3 rounded-xl disabled:opacity-50"
        >
          {pending === "accept" ? "Joining…" : "Accept invitation"}
        </button>
        <button
          onClick={handleDecline}
          disabled={pending !== null}
          className="bg-transparent border border-slate-700 text-slate-300 font-medium text-sm px-6 py-3 rounded-xl disabled:opacity-50"
        >
          {pending === "decline" ? "Declining…" : "Decline"}
        </button>
      </div>
      {error && <p className="text-xs text-red-400 mt-4">{error}</p>}
    </div>
  );
}
