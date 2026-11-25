"use client";

import { UpgradePrompt } from "@/app/dashboard/_components/UpgradePrompt";
import { useState } from "react";
import { Check, Mail, Send, ShieldCheck, UserMinus, Users } from "lucide-react";
import { Avatar, Badge, Button, ButtonLink, Input, Modal, SegmentedControl, Select, useToast } from "../ui";
import { SITE_ROLE_INFO, type SiteAccess } from "@/lib/access/siteAccess";
import { SiteAccessPicker, type PickableSite } from "./SiteAccessPicker";
import { usageMeter } from "@/lib/dashboardV3/settingsUsage";
import { errMsg, hubApi } from "../hub/hubApi";
import { AsideCard, Notice, Panel, SettingsPageShell, UsageMeter } from "./bits";
import { GateOrError } from "../../_components/UpgradePrompt";
import { TourAnchorAbsent } from "../tour/TourAnchorAbsent";

export type TeamMember = { id: string; userId: string; role: string; scopedTemplateIds: string[]; siteAccess?: SiteAccess; name: string; email: string };
export type TeamInvite = { id: string; email: string; role: string; scopedTemplateIds: string[]; siteAccess?: SiteAccess; createdAt: string };

/** Roles in plain words (the same roles the server knows). */
export const TEAM_ROLES: { value: string; label: string; body: string }[] = [
  { value: "admin", label: "Manager", body: "Can invite people and change settings, as well as everything an Editor can do." },
  { value: "editor", label: "Editor", body: "Can change, add and publish pages." },
  { value: "blogger", label: "Writer", body: "Can write and publish blog posts. Nothing else." },
  { value: "commenter", label: "Reviewer", body: "Can look at your sites and leave comments." },
  { value: "viewer", label: "Viewer", body: "Can look, but not change anything." },
];
const roleLabel = (r: string) => (r === "owner" ? "Owner" : r === "guest" ? "Some sites only" : (TEAM_ROLES.find((x) => x.value === r)?.label ?? r));

export function TeamSection({ currentUserId, currentRole, organizationName, members: m0, invitations: i0, sites = [], seatLimit = null, mock = false }: { sites?: PickableSite[]; seatLimit?: number | null; currentUserId: string; currentRole: string; organizationName: string; members: TeamMember[]; invitations: TeamInvite[]; mock?: boolean }) {
  const { show } = useToast();
  const [members, setMembers] = useState(m0);
  const [invites, setInvites] = useState(i0);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [scope, setScope] = useState<"all" | "sites">("all");
  const [inviteSites, setInviteSites] = useState<SiteAccess>({});
  const [editing, setEditing] = useState<{ member: TeamMember; access: SiteAccess } | null>(null);
  const siteName = (id: string) => sites.find((x) => x.id === id)?.name ?? "A site";
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
    const siteOnly = scope === "sites";
    if (siteOnly && Object.keys(inviteSites).length === 0) return setError("Tick at least one site they should be able to open.");
    const sentRole = siteOnly ? "guest" : role;
    const sentAccess = siteOnly ? inviteSites : undefined;
    const r = await call("invite", async () => (mock ? { invitation: { id: `i${Date.now()}` } } : hubApi<{ invitation?: { id: string } }>("/api/org/invite", { method: "POST", json: { email: to, role: sentRole, scopedTemplateIds: [], ...(sentAccess ? { siteAccess: sentAccess } : {}) } }, "We couldn't send that invite. Please try again.")));
    if (r?.invitation?.id) {
      setInvites((p) => [{ id: r.invitation!.id, email: to, role: sentRole, scopedTemplateIds: [], siteAccess: sentAccess, createdAt: new Date().toISOString() }, ...p]);
      setEmail("");
      setInviteSites({});
      show({ title: "Invite sent", description: `${to} will get an email with a link to join.`, tone: "success" });
    }
  };

  const saveSites = async () => {
    if (!editing) return;
    if (Object.keys(editing.access).length === 0) return setError("Tick at least one site, or remove this person from your team.");
    const { member, access } = editing;
    const ok = await call(`sites-${member.id}`, async () => (mock ? true : hubApi(`/api/org/members/${member.userId}`, { method: "PATCH", json: { role: "guest", siteAccess: access } }, "We couldn't save that. Please try again.")));
    if (ok) {
      setMembers((all) => all.map((x) => (x.id === member.id ? { ...x, siteAccess: access } : x)));
      setEditing(null);
      show({ title: "Access saved", tone: "success" });
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
          <AsideCard title="Seats" icon={Users}>
            <UsageMeter label="Teammates" meter={seats} unit={{ one: "teammate", many: "teammates" }} hint={seatLimit === 0 ? "Inviting people comes with the Starter plan." : seats.tone === "full" ? "All seats are used. Upgrade to add more people." : `${total} ${total === 1 ? "person" : "people"} in all, counting you.`} />
            {seatLimit === 0 || seats.tone === "full" ? <UpgradePrompt tone="info" requiredPlan={seatLimit === 0 ? "STARTER" : "PRO"} message={seatLimit === 0 ? "Inviting teammates comes with the Starter plan." : "All your seats are used. Upgrade to add more people."} /> : null}
          </AsideCard>
          <AsideCard title="What can each role do?" icon={ShieldCheck}>
            <ul>
              {TEAM_ROLES.map((r) => (
                <li key={r.value}><Check size={16} aria-hidden /> <span><b>{r.label}.</b> {r.body}</span></li>
              ))}
            </ul>
          </AsideCard>
        </>
      }
    >
      <GateOrError error={error}><Notice tone="bad">{error}</Notice></GateOrError>

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
                {p.role === "guest" ? (
                  <span className="plx-siteaccess__chips" style={{ marginTop: 6 }}>
                    {Object.entries(p.siteAccess ?? {}).map(([id, r]) => <Badge key={id} tone="neutral">{siteName(id)}: {SITE_ROLE_INFO[r].label}</Badge>)}
                  </span>
                ) : null}
              </div>
              <div className="plx-person__end">
                {editable && p.role === "guest" ? (
                  <>
                    <Button variant="secondary" size="sm" onClick={() => setEditing({ member: p, access: { ...(p.siteAccess ?? {}) } })}>Change sites</Button>
                    <Button variant="ghost" size="sm" leftIcon={<UserMinus size={16} aria-hidden />} loading={busy === `rm-${p.id}`} onClick={async () => {
                      if (!window.confirm(`Take ${p.name || p.email} off your team? They'll lose access straight away.`)) return;
                      const ok = await call(`rm-${p.id}`, async () => (mock ? true : hubApi(`/api/org/members/${p.userId}`, { method: "DELETE" }, "We couldn't remove them. Please try again.")));
                      if (ok) setMembers((all) => all.filter((x) => x.id !== p.id));
                    }}>Remove</Button>
                  </>
                ) : editable ? (
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

      <TourAnchorAbsent anchor="team-invite" absent={!canManage} />
      {canManage ? (
        <Panel title="Invite someone" description="They get an email. Nothing changes until they say yes." data-tour="team-invite">
          <div className="plx-sform plx-sform--wide">
            {sites.length > 0 ? (
              <SegmentedControl label="What can they open?" value={scope} onChange={setScope} options={[{ value: "all", label: "The whole workspace" }, { value: "sites", label: "Only some sites" }]} />
            ) : null}
            <div className="plx-sform__two">
              <Input label="Their email" type="email" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" onKeyDown={(e) => e.key === "Enter" && void invite()} />
              {scope === "all" ? <Select label="What can they do?" value={role} onChange={(e) => setRole(e.target.value)} options={TEAM_ROLES.map((r) => ({ value: r.value, label: r.label }))} help={TEAM_ROLES.find((r) => r.value === role)?.body} /> : null}
            </div>
            {scope === "sites" ? <SiteAccessPicker sites={sites} value={inviteSites} onChange={setInviteSites} /> : null}
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
                <span>{v.role === "guest" ? `Invited to ${Object.keys(v.siteAccess ?? {}).length} ${Object.keys(v.siteAccess ?? {}).length === 1 ? "site" : "sites"}` : `Invited as ${roleLabel(v.role)}`}</span>
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
      <Modal open={editing !== null} onClose={() => busy === null && setEditing(null)} title={editing ? `Sites for ${editing.member.name || editing.member.email}` : ""} width={620} footer={<><Button variant="secondary" disabled={busy !== null} onClick={() => setEditing(null)}>Cancel</Button><Button loading={busy?.startsWith("sites-") ?? false} onClick={() => void saveSites()}>Save</Button></>}>
        {editing ? <SiteAccessPicker sites={sites} value={editing.access} onChange={(access) => setEditing({ ...editing, access })} /> : null}
      </Modal>
    </SettingsPageShell>
  );
}
