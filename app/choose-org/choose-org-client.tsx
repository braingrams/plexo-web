"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { ChevronRight } from "lucide-react";
import { Alert } from "@/app/auth/_kit/ui";
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
      const res: any = await authClient.organization.setActive({ organizationId });
      if (res?.error) {
        throw new Error(res.error.message ?? "Couldn't switch organizations.");
      }
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't switch organizations. Try again.");
      setPendingId(null);
    }
  }

  return (
    <div className="ax-stack">
      <div className="ax-org-list">
        {organizations.map((org) => (
          <button key={org.id} type="button" onClick={() => handleSelect(org.id)} disabled={pendingId !== null} className="ax-org" aria-busy={pendingId === org.id || undefined}>
            <span className="ax-org-avatar" aria-hidden="true">{org.name.trim().charAt(0).toUpperCase() || "?"}</span>
            <span className="ax-org-name">{org.name}</span>
            <span className="ax-org-role">{pendingId === org.id ? "Opening…" : (ROLE_LABELS[org.role] ?? org.role)}</span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        ))}
      </div>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
