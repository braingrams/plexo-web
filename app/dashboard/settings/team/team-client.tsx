"use client";

import { useState } from "react";

import { authClient } from "@/lib/auth-client";
import { Card } from "@/app/dashboard/_components/Card";
import { Avatar } from "@/app/dashboard/_components/Avatar";
import { CustomSelect } from "@/app/_components/CustomSelect";

type Member = { id: string; userId: string; role: string; name: string; email: string };
type Invitation = { id: string; email: string; role: string; createdAt: string };

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  commenter: "Commenter",
  viewer: "Viewer",
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
  admin: "Manage members, templates, domains, and API keys.",
  editor: "Create, edit, publish, and comment on templates.",
  commenter: "View templates and leave comments.",
  viewer: "View templates and comment threads only.",
};

// Owner isn't offered on invite — ownership transfer is a separate, deliberate action,
// not something granted through the regular invite flow.
const INVITABLE_ROLES = ["admin", "editor", "commenter", "viewer"];

export function TeamClient({
  currentUserId,
  currentRole,
  organizationName,
  initialMembers,
  initialInvitations,
}: {
  currentUserId: string;
  currentRole: string;
  organizationName: string;
  initialMembers: Member[];
  initialInvitations: Invitation[];
}) {
  const [members, setMembers] = useState(initialMembers);
  const [invitations, setInvitations] = useState(initialInvitations);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canManageMembers = currentRole === "owner" || currentRole === "admin";

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = email.trim();
    if (!trimmed) return;
    setInviting(true);
    try {
      // better-auth client methods resolve with { data, error } rather than throwing on
      // an API-level failure (bad permission, duplicate invite, etc.) — a bare try/catch
      // alone never sees those, so `res.error` must be checked explicitly. Missing this
      // check previously let a failed invite fall through as if it had an `invitation`
      // (actually the whole { data: null, error } wrapper), adding a row with a
      // `undefined` id to the list — which is what the React "missing key" warning below
      // was actually pointing at.
      const res: any = await authClient.organization.inviteMember({ email: trimmed, role: role as any });
      if (res?.error) {
        throw new Error(res.error.message ?? "Couldn't send that invite.");
      }
      const invitation = res?.data;
      if (!invitation?.id) {
        throw new Error("Unexpected response from the server.");
      }
      setInvitations((prev) => [
        { id: invitation.id, email: trimmed, role, createdAt: new Date().toISOString() },
        ...prev,
      ]);
      setEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send that invite. Try again.");
    } finally {
      setInviting(false);
    }
  }

  async function handleCancelInvite(id: string) {
    setInvitations((prev) => prev.filter((i) => i.id !== id));
    try {
      const res: any = await authClient.organization.cancelInvitation({ invitationId: id });
      if (res?.error) throw new Error(res.error.message ?? "Couldn't cancel that invite.");
    } catch {
      // Best-effort UI removal even if the server call fails — a stale row is harmless.
    }
  }

  async function handleRoleChange(memberId: string, userId: string, nextRole: string) {
    setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, role: nextRole } : m)));
    try {
      const res: any = await authClient.organization.updateMemberRole({ memberId, role: nextRole });
      if (res?.error) throw new Error(res.error.message ?? "Couldn't update that member's role.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update that member's role.");
    }
  }

  async function handleRemove(memberId: string) {
    if (!confirm("Remove this member from the organization?")) return;
    setMembers((prev) => prev.filter((m) => m.id !== memberId));
    try {
      const res: any = await authClient.organization.removeMember({ memberIdOrEmail: memberId });
      if (res?.error) throw new Error(res.error.message ?? "Couldn't remove that member.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove that member.");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {canManageMembers && (
        <Card>
          <h2 style={{ fontSize: "0.95rem", fontWeight: 700, color: "#f0f2ff", marginBottom: "0.9rem" }}>
            Invite a teammate
          </h2>
          <form onSubmit={handleInvite} style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
            <input
              type="email"
              required
              placeholder="teammate@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{
                flex: "1 1 240px", background: "#090d16", border: "1px solid rgba(255,255,255,0.09)",
                borderRadius: 10, padding: "0.65rem 0.9rem", color: "#f0f2ff", fontSize: "0.85rem",
              }}
            />
            <div style={{ minWidth: 160 }}>
              <CustomSelect
                value={role}
                options={INVITABLE_ROLES.map((r) => ({ label: ROLE_LABELS[r], value: r }))}
                onChange={setRole}
              />
            </div>
            <button
              type="submit"
              disabled={inviting}
              style={{
                background: "var(--brand)", border: "none", borderRadius: 10,
                padding: "0.65rem 1.4rem", color: "#fff", fontWeight: 700, fontSize: "0.85rem",
                cursor: inviting ? "not-allowed" : "pointer", opacity: inviting ? 0.6 : 1,
              }}
            >
              {inviting ? "Sending…" : "Send invite"}
            </button>
          </form>
          <p style={{ fontSize: "0.75rem", color: "rgba(240,242,255,0.4)", marginTop: "0.6rem" }}>
            {ROLE_DESCRIPTIONS[role]}
          </p>
          {error && <p style={{ fontSize: "0.78rem", color: "#f87171", marginTop: "0.5rem" }}>{error}</p>}
        </Card>
      )}

      {invitations.length > 0 && (
        <Card>
          <h2 style={{ fontSize: "0.95rem", fontWeight: 700, color: "#f0f2ff", marginBottom: "0.9rem" }}>
            Pending invitations
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {invitations.map((inv) => (
              <div key={inv.id} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "0.6rem 0.8rem", borderRadius: 10, background: "rgba(255,255,255,0.03)",
              }}>
                <div>
                  <p style={{ fontSize: "0.85rem", color: "#f0f2ff" }}>{inv.email}</p>
                  <p style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.4)" }}>{ROLE_LABELS[inv.role] ?? inv.role} · pending</p>
                </div>
                {canManageMembers && (
                  <button
                    onClick={() => handleCancelInvite(inv.id)}
                    style={{ background: "none", border: "none", color: "#f87171", fontSize: "0.78rem", cursor: "pointer" }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <h2 style={{ fontSize: "0.95rem", fontWeight: 700, color: "#f0f2ff", marginBottom: "0.9rem" }}>
          Members ({members.length})
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {members.map((m) => (
            <div key={m.id} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem",
              padding: "0.6rem 0.8rem", borderRadius: 10, background: "rgba(255,255,255,0.03)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", minWidth: 0 }}>
                <Avatar name={m.name} email={m.email} size={32} />
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: "0.85rem", fontWeight: 600, color: "#f0f2ff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {m.name} {m.userId === currentUserId && <span style={{ color: "rgba(240,242,255,0.4)", fontWeight: 400 }}>(you)</span>}
                  </p>
                  <p style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.4)" }}>{m.email}</p>
                </div>
              </div>

              {canManageMembers && m.role !== "owner" && m.userId !== currentUserId ? (
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
                  <div style={{ minWidth: 140 }}>
                    <CustomSelect
                      value={m.role}
                      options={INVITABLE_ROLES.map((r) => ({ label: ROLE_LABELS[r], value: r }))}
                      onChange={(value) => handleRoleChange(m.id, m.userId, value)}
                    />
                  </div>
                  <button
                    onClick={() => handleRemove(m.id)}
                    style={{ background: "none", border: "none", color: "#f87171", fontSize: "0.78rem", cursor: "pointer" }}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <span style={{
                  flexShrink: 0, fontSize: "0.72rem", fontWeight: 700, color: "var(--brand)",
                  background: "var(--brand-subtle)", padding: "0.3rem 0.7rem", borderRadius: 999,
                }}>
                  {ROLE_LABELS[m.role] ?? m.role}
                </span>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
