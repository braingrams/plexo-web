"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { authClient } from "@/lib/auth-client";

export function AcceptInviteClient({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAccept() {
    setPending("accept");
    setError(null);
    try {
      const res: any = await authClient.organization.acceptInvitation({ invitationId });
      const organizationId = res?.data?.invitation?.organizationId ?? res?.data?.member?.organizationId;
      if (organizationId) {
        await authClient.organization.setActive({ organizationId });
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
      await authClient.organization.rejectInvitation({ invitationId });
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
