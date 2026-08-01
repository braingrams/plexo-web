"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { authClient } from "@/lib/auth-client";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  commenter: "Commenter",
  viewer: "Viewer",
};

export function ChooseOrgClient({
  organizations,
}: {
  organizations: { id: string; name: string; role: string }[];
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSelect(organizationId: string) {
    setPendingId(organizationId);
    setError(null);
    try {
      await authClient.organization.setActive({ organizationId });
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't switch organizations. Try again.");
      setPendingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {organizations.map((org) => (
        <button
          key={org.id}
          onClick={() => handleSelect(org.id)}
          disabled={pendingId !== null}
          className="w-full flex items-center justify-between bg-[#090d16] border border-slate-800 hover:border-purple-500 rounded-xl px-4 py-3.5 text-left transition-all disabled:opacity-50"
        >
          <span className="text-sm font-medium text-white">{org.name}</span>
          <span className="text-xs text-slate-500">{ROLE_LABELS[org.role] ?? org.role}</span>
        </button>
      ))}
      {error && <p className="text-xs text-red-400 mt-2 text-center">{error}</p>}
    </div>
  );
}
