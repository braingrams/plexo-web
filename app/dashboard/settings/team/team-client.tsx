"use client";

import { useEffect, useState } from "react";

import { Card } from "@/app/dashboard/_components/Card";
import { Avatar } from "@/app/dashboard/_components/Avatar";
import { CustomSelect } from "@/app/_components/CustomSelect";

type Member = { id: string; userId: string; role: string; scopedTemplateIds: string[]; name: string; email: string };
type Invitation = { id: string; email: string; role: string; scopedTemplateIds: string[]; createdAt: string };
type TemplateOption = { id: string; name: string };

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  blogger: "Blogger",
  commenter: "Commenter",
  viewer: "Viewer",
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
  admin: "Manage members, templates, domains, and API keys.",
  editor: "Create, edit, publish, and comment on templates.",
  blogger: "Write and publish blog posts only — no page or commerce access.",
  commenter: "View templates and leave comments.",
  viewer: "View templates and comment threads only.",
};

// Owner isn't offered on invite — ownership transfer is a separate, deliberate action,
// not something granted through the regular invite flow.
const INVITABLE_ROLES = ["admin", "editor", "blogger", "commenter", "viewer"];

// Granular-permissions v1 — an editor can optionally be restricted to specific pages
// instead of the org-wide access every role gets today (server/requireTemplateScope.ts
// enforces this on every template-mutation route). Leaving the checklist empty keeps
// today's unchanged org-wide editor behavior.
function TemplateChecklist({
  templates,
  selected,
  onChange,
}: {
  templates: TemplateOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  if (templates.length === 0) {
    return <p style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.35)" }}>No pages in this organization yet.</p>;
  }

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }

  return (
    <div
      style={{
        maxHeight: 160, overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.35rem",
        background: "#090d16", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 10, padding: "0.5rem 0.7rem",
        minWidth: 220,
      }}
    >
      {templates.map((t) => (
        <label key={t.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8rem", color: "#f0f2ff", cursor: "pointer" }}>
          <input type="checkbox" checked={selected.includes(t.id)} onChange={() => toggle(t.id)} />
          {t.name}
        </label>
      ))}
    </div>
  );
}

// Inline "N pages — edit" / "All pages" affordance on an existing editor's row —
// collapsed by default so it doesn't clutter the member list for the common (org-wide)
// case, opens into the same checklist used at invite time.
function MemberScopeControl({
  templates,
  scopedTemplateIds,
  onSave,
}: {
  templates: TemplateOption[];
  scopedTemplateIds: string[];
  onSave: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(scopedTemplateIds);

  useEffect(() => {
    setDraft(scopedTemplateIds);
  }, [scopedTemplateIds]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{ background: "none", border: "none", color: "rgba(240,242,255,0.5)", fontSize: "0.72rem", cursor: "pointer", textDecoration: "underline" }}
      >
        {scopedTemplateIds.length === 0 ? "All pages" : `${scopedTemplateIds.length} page${scopedTemplateIds.length === 1 ? "" : "s"} — edit`}
      </button>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", alignItems: "flex-end" }}>
      <TemplateChecklist templates={templates} selected={draft} onChange={setDraft} />
      <div style={{ display: "flex", gap: "0.4rem" }}>
        <button
          onClick={() => {
            onSave(draft);
            setOpen(false);
          }}
          style={{ background: "var(--brand)", border: "none", borderRadius: 8, padding: "0.3rem 0.7rem", color: "#fff", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer" }}
        >
          Save
        </button>
        <button
          onClick={() => {
            setDraft(scopedTemplateIds);
            setOpen(false);
          }}
          style={{ background: "none", border: "none", color: "rgba(240,242,255,0.5)", fontSize: "0.72rem", cursor: "pointer" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

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
  const [inviteScopedTemplateIds, setInviteScopedTemplateIds] = useState<string[]>([]);
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);

  const canManageMembers = currentRole === "owner" || currentRole === "admin";

  // Only fetched for Owners/Admins — they're the only ones who can see the invite form or
  // the per-editor page-scoping control that needs this list.
  useEffect(() => {
    if (!canManageMembers) return;
    fetch("/api/templates")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { templates?: { id: string; name: string }[] } | null) => {
        if (body?.templates) {
          setTemplates(body.templates.map((t) => ({ id: t.id, name: t.name })));
        }
      })
      .catch(() => {
        // Best-effort — the scoping checklist just shows "No pages" if this fails; it
        // never blocks inviting/role-changing with org-wide (unscoped) access.
      });
  }, [canManageMembers]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = email.trim();
    if (!trimmed) return;
    setInviting(true);
    try {
      const scopedTemplateIds = role === "editor" ? inviteScopedTemplateIds : [];
      const res = await fetch("/api/org/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, role, scopedTemplateIds }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? "Couldn't send that invite.");
      }
      const invitation = body.invitation;
      if (!invitation?.id) {
        throw new Error("Unexpected response from the server.");
      }
      setInvitations((prev) => [
        { id: invitation.id, email: trimmed, role, scopedTemplateIds, createdAt: new Date().toISOString() },
        ...prev,
      ]);
      setEmail("");
      setInviteScopedTemplateIds([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send that invite. Try again.");
    } finally {
      setInviting(false);
    }
  }

  async function handleCancelInvite(id: string) {
    setInvitations((prev) => prev.filter((i) => i.id !== id));
    try {
      const res = await fetch(`/api/org/invite/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Couldn't cancel that invite.");
      }
    } catch {
      // Best-effort UI removal even if the server call fails — a stale row is harmless.
    }
  }

  async function handleRoleChange(memberId: string, userId: string, nextRole: string) {
    // Switching away from editor clears any existing page scope — the server does this
    // itself (server/orgDynamo.ts's updateMemberRole), mirrored here so the UI doesn't
    // show a stale "N pages" badge for a role that can no longer be scoped.
    setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, role: nextRole, scopedTemplateIds: nextRole === "editor" ? m.scopedTemplateIds : [] } : m)));
    try {
      const res = await fetch(`/api/org/members/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: nextRole }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Couldn't update that member's role.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update that member's role.");
    }
  }

  async function handleScopeChange(memberId: string, userId: string, scopedTemplateIds: string[]) {
    setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, scopedTemplateIds } : m)));
    try {
      const res = await fetch(`/api/org/members/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "editor", scopedTemplateIds }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Couldn't update that member's page access.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update that member's page access.");
    }
  }

  async function handleRemove(memberId: string) {
    if (!confirm("Remove this member from the organization?")) return;
    setMembers((prev) => prev.filter((m) => m.id !== memberId));
    try {
      const res = await fetch(`/api/org/members/${memberId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Couldn't remove that member.");
      }
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
                onChange={(value) => {
                  setRole(value);
                  if (value !== "editor") setInviteScopedTemplateIds([]);
                }}
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
          {role === "editor" && (
            <div style={{ marginTop: "0.6rem" }}>
              <p style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.5)", marginBottom: "0.4rem" }}>
                Restrict to specific pages (optional — leave empty for org-wide editor access)
              </p>
              <TemplateChecklist templates={templates} selected={inviteScopedTemplateIds} onChange={setInviteScopedTemplateIds} />
            </div>
          )}
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
                  <p style={{ fontSize: "0.72rem", color: "rgba(240,242,255,0.4)" }}>
                    {ROLE_LABELS[inv.role] ?? inv.role}
                    {inv.role === "editor" && inv.scopedTemplateIds.length > 0
                      ? ` · ${inv.scopedTemplateIds.length} page${inv.scopedTemplateIds.length === 1 ? "" : "s"}`
                      : ""}
                    {" · pending"}
                  </p>
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
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.35rem", flexShrink: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
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
                  {m.role === "editor" && (
                    <MemberScopeControl
                      templates={templates}
                      scopedTemplateIds={m.scopedTemplateIds}
                      onSave={(ids) => handleScopeChange(m.id, m.userId, ids)}
                    />
                  )}
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
