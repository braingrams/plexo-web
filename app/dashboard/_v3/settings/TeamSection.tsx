"use client";

import { useState } from "react";
import { Check, Mail, Send, UserMinus } from "lucide-react";
import { Avatar, Badge, Button, ButtonLink, Input, Select, useToast } from "../ui";
import { usageMeter } from "@/lib/dashboardV3/settingsUsage";
import { errMsg, hubApi } from "../hub/hubApi";
import { AsideCard, Notice, Panel, SettingsPageShell, UsageMeter } from "./bits";

export type TeamMember = { id: string; userId: string; role: string; scopedTemplateIds: string[]; name: string; email: string };
export type TeamInvite = { id: string; email: string; role: string; scopedTemplateIds: string[]; createdAt: string };

/** Roles in plain words (the same roles the server knows). */
export const TEAM_ROLES: { value: string; label: string; body: string }[] = [
  { value: "admin", label: "Manager", body: "Can invite people and change settings, as well as everything an Editor can do." },
  { value: "editor", label: "Editor", body: "Can change, add and publish pages." },
  { value: "blogger", label: "Writer", body: "Can write and publish blog posts. Nothing else." },
  { value: "commenter", label: "Reviewer", body: "Can look at your sites and leave comments." },
  { value: "viewer", label: "Viewer", body: "Can look, but not change anything." },
];
const roleLabel = (r: string) => (r === "owner" ? "Owner" : (TEAM_ROLES.find((x) => x.value === r)?.label ?? r));

export function TeamSection({ currentUserId, currentRole, organizationName, members: m0, invitations: i0, seatLimit = null, mock = false }: { seatLimit?: number | null; currentUserId: string; currentRole: string; organizationName: string; members: TeamMember[]; invitations: TeamInvite[]; mock?: boolean }) {
  const { show } = useToast();
  const [members, setMembers] = useState(m0);
  const [invites, setInvites] = useState(i0);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canManage = currentRole === "owner" || currentRole === "admin";

  const call = async <T,>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(key);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(errMsg(e));
      return undefined;
    } finally {
      setBusy(null);
    }
  };

  const invite = async () => {
    const to = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return setError("That doesn't look like an email address. Please check it and try again.");
    const r = await call("invite", async () => (mock ? { invitation: { id: `i${Date.now()}` } } : hubApi<{ invitation?: { id: string } }>("/api/org/invite", { method: "POST", json: { email: to, role, scopedTemplateIds: [] } }, "We couldn't send that invite. Please try again.")));
    if (r?.invitation?.id) {
      setInvites((p) => [{ id: r.invitation!.id, email: to, role, scopedTemplateIds: [], createdAt: new Date().toISOString() }, ...p]);
      setEmail("");
      show({ title: "Invite sent", description: `${to} will get an email with a link to join.`, tone: "success" });
    }
  };

  const total = members.length;
  const seats = usageMeter(Math.max(0, total - 1), seatLimit);
  const roleBadge = (r: string) => (r === "owner" ? "brand" : r === "admin" ? "info" : r === "editor" ? "success" : "neutral") as "brand" | "info" | "success" | "neutral";
  return (
    <SettingsPageShell
      title="Team"
      purpose={`The people who help with ${organizationName}, and what each of them can do.`}
      aside={
        <>
          <AsideCard title="Seats">
            <UsageMeter label="Teammates" meter={seats} unit={{ one: "teammate", many: "teammates" }} hint={seatLimit === 0 ? "Inviting people comes with the Starter plan." : seats.tone === "full" ? "All seats are used. Upgrade to add more people." : `${total} ${total === 1 ? "person" : "people"} in all, counting you.`} />
            {seatLimit === 0 || seats.tone === "full" ? <ButtonLink href="/dashboard/settings/plan" variant="secondary">See plans</ButtonLink> : null}
          </AsideCard>
          <AsideCard title="What can each role do?">
            <ul>
              {TEAM_ROLES.map((r) => (
                <li key={r.value}><Check size={16} aria-hidden /> <span><b>{r.label}.</b> {r.body}</span></li>
              ))}
            </ul>
          </AsideCard>
        </>
      }
    >
      {error ? <Notice tone="bad">{error}</Notice> : null}

      <Panel title="People" description={`${total} ${total === 1 ? "person" : "people"} can work on ${organizationName}.`} flush data-tour="team-seats">
        {members.map((p) => {
          const you = p.userId === currentUserId;
          const editable = canManage && p.role !== "owner" && !you;
          return (
            <div key={p.id} className="plx-person">
              <Avatar name={p.name || p.email} size={44} />
              <div className="plx-person__main">
                <b>{p.name || p.email}{you ? " (you)" : ""}</b>
                <span>{p.email}</span>
              </div>
              <div className="plx-person__end">
                {editable ? (
                  <>
                    <Select label={`Role for ${p.name || p.email}`} hideLabel value={p.role} disabled={busy === p.id} onChange={async (e) => {
                      const next = e.target.value;
                      const before = p.role;
                      setMembers((all) => all.map((x) => (x.id === p.id ? { ...x, role: next } : x)));
                      const ok = await call(p.id, async () => (mock ? true : hubApi(`/api/org/members/${p.userId}`, { method: "PATCH", json: { role: next } }, "We couldn't change that. Please try again.")));
                      if (!ok) setMembers((all) => all.map((x) => (x.id === p.id ? { ...x, role: before } : x)));
                      else show({ title: "Role changed", tone: "success" });
                    }} options={TEAM_ROLES.map((r) => ({ value: r.value, label: r.label }))} />
                    <Button variant="ghost" size="sm" leftIcon={<UserMinus size={16} aria-hidden />} loading={busy === `rm-${p.id}`} onClick={async () => {
                      if (!window.confirm(`Take ${p.name || p.email} off your team? They'll lose access straight away.`)) return;
                      const ok = await call(`rm-${p.id}`, async () => (mock ? true : hubApi(`/api/org/members/${p.userId}`, { method: "DELETE" }, "We couldn't remove them. Please try again.")));
                      if (ok) setMembers((all) => all.filter((x) => x.id !== p.id));
                    }}>Remove</Button>
                  </>
                ) : (
                  <Badge tone={roleBadge(p.role)}>{roleLabel(p.role)}{p.role === "editor" && p.scopedTemplateIds.length ? `, ${p.scopedTemplateIds.length} page${p.scopedTemplateIds.length === 1 ? "" : "s"} only` : ""}</Badge>
                )}
              </div>
            </div>
          );
        })}
      </Panel>

      {canManage ? (
        <Panel title="Invite someone" description="They get an email. Nothing changes until they say yes." data-tour="team-invite">
          <div className="plx-sform plx-sform--wide">
            <div className="plx-sform__two">
              <Input label="Their email" type="email" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" onKeyDown={(e) => e.key === "Enter" && void invite()} />
              <Select label="What can they do?" value={role} onChange={(e) => setRole(e.target.value)} options={TEAM_ROLES.map((r) => ({ value: r.value, label: r.label }))} help={TEAM_ROLES.find((r) => r.value === role)?.body} />
            </div>
            <div>
              <Button loading={busy === "invite"} leftIcon={<Send size={16} aria-hidden />} onClick={invite}>Send invite</Button>
            </div>
          </div>
        </Panel>
      ) : null}

      {invites.length ? (
        <Panel title="Waiting for a reply" description="These people haven't said yes yet." flush>
          {invites.map((v) => (
            <div key={v.id} className="plx-person">
              <span className="plx-tile" style={{ borderRadius: 999 }}><Mail size={18} aria-hidden /></span>
              <div className="plx-person__main">
                <b>{v.email}</b>
                <span>Invited as {roleLabel(v.role)}</span>
              </div>
              <div className="plx-person__end">
                <Badge tone="warning">Waiting</Badge>
                {canManage ? (
                  <Button variant="ghost" size="sm" loading={busy === `inv-${v.id}`} onClick={async () => {
                    const ok = await call(`inv-${v.id}`, async () => (mock ? true : hubApi(`/api/org/invite/${v.id}`, { method: "DELETE" }, "We couldn't cancel that invite. Please try again.")));
                    if (ok) setInvites((all) => all.filter((x) => x.id !== v.id));
                  }}>Cancel invite</Button>
                ) : null}
              </div>
            </div>
          ))}
        </Panel>
      ) : null}
    </SettingsPageShell>
  );
}
