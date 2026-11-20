"use client";

import { useEffect, useState } from "react";
import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import { useRouter } from "next/navigation";
import { CircleCheck, Eye } from "lucide-react";
import { Badge, Button, Input, Select } from "../../ui";
import type { InitialNotificationsSettings } from "@/app/dashboard/commerce/[templateId]/settings/notifications/NotificationsSettingsClient";
import { EMAIL_EVENTS, emailPreview, type EmailEvent } from "@/lib/commerce/shopSettingsForm";
import { friendlyConnectError, groupLabel } from "@/lib/commerce/mailingList";
import { MailingConnect } from "./MailingConnect";
import { Group, SaveBar, Switch, putSettings, useSettingsForm } from "./useSettingsForm";

export type EmailsInitial = { shopName: string; flags: Record<EmailEvent, boolean>; mailing: InitialNotificationsSettings };
type MGroup = { id: string; title: string; description: string | null; totalContacts: number };
type V = { flags: Record<EmailEvent, boolean>; paid: string; news: string; popup: boolean };

function GroupPicker({ label, help, templateId, groups, value, onChange, onCreated }: { label: string; help: string; templateId: string; groups: MGroup[] | null; value: string; onChange: (id: string) => void; onCreated: (g: MGroup) => void }) {
  const [making, setMaking] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function create() {
    if (!title.trim()) return setError("Give your new list a name, like “Customers”.");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/maildrip/${templateId}/groups`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: title.trim() }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(friendlyConnectError(d.error));
      onCreated(d.group);
      onChange(d.group.id);
      setMaking(false);
      setTitle("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't make that list.");
    } finally {
      setBusy(false);
    }
  }
  return making ? (
    <div className="plx-form">
      <Input label={`New list for: ${label.toLowerCase()}`} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      {error ? <GateOrError error={error}><p className="plx-field__error" role="alert">{error}</p></GateOrError> : null}
      <div style={{ display: "flex", gap: 8 }}><Button loading={busy} onClick={create}>Make this list</Button><Button variant="ghost" onClick={() => { setMaking(false); setError(null); }}>Cancel</Button></div>
    </div>
  ) : (
    <Select label={label} help={help} value={value} disabled={groups === null} onChange={(e) => (e.target.value === "__new__" ? setMaking(true) : onChange(e.target.value))} options={[{ value: "", label: groups === null ? "Loading your lists…" : "Don't add them anywhere" }, ...(groups ?? []).map((g) => ({ value: g.id, label: groupLabel(g) })), { value: "__new__", label: "Make a new list…" }]} />
  );
}

/** Shop settings, Emails: which order emails customers get (with an example of each), and your mailing list. */
export function EmailsPanel({ templateId, initial }: { templateId: string; initial: EmailsInitial }) {
  const router = useRouter();
  const [preview, setPreview] = useState<EmailEvent>("Paid");
  const [connected, setConnected] = useState(initial.mailing.maildripConnected);
  const [groups, setGroups] = useState<MGroup[] | null>(null);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const form = useSettingsForm<V>({ flags: initial.flags, paid: initial.mailing.maildripPaidGroupId, news: initial.mailing.maildripNewsletterGroupId, popup: initial.mailing.newsletterPopupEnabled }, async (v) => {
    const res = await putSettings(templateId, { ...Object.fromEntries(EMAIL_EVENTS.map((e) => [`notifyCustomerOn${e.id}`, v.flags[e.id]])), ...(connected ? { maildripPaidGroupId: v.paid, maildripNewsletterGroupId: v.news, newsletterPopupEnabled: v.popup && !!v.news } : {}) });
    if (res.error) return { error: res.error };
  });
  const v = form.values;

  useEffect(() => {
    if (!connected) return;
    let live = true;
    setGroups(null);
    setGroupsError(null);
    fetch(`/api/v1/maildrip/${templateId}/groups`).then((r) => r.json().then((d) => ({ ok: r.ok, d }))).then(({ ok, d }) => {
      if (!live) return;
      if (!ok) throw new Error(friendlyConnectError(d.error));
      setGroups(d.groups);
    }).catch((e) => live && setGroupsError(e instanceof Error ? e.message : "We couldn't load your lists."));
    return () => { live = false; };
  }, [connected, templateId]);

  async function disconnect() {
    if (!window.confirm("Disconnect MailDrip? New customers and sign-ups will stop being added to your lists. Your lists in MailDrip stay as they are.")) return;
    setDisconnecting(true);
    await fetch(`/api/v1/maildrip/${templateId}/connect`, { method: "DELETE" }).catch(() => undefined);
    setConnected(false);
    setGroups(null);
    form.patch({ paid: "", news: "", popup: false });
    setDisconnecting(false);
    router.refresh();
  }

  const ex = emailPreview(preview, initial.shopName);
  const on = v.flags[preview];
  const setFlag = (id: EmailEvent, c: boolean) => form.patch({ flags: { ...v.flags, [id]: c } });

  return (
    <div className="plx-hset" data-tour="shop-emails">
      <Group title="Emails your customers get" help="We send these for you as an order moves along. Switch off any you don't want to send.">
        {EMAIL_EVENTS.map((e) => (
          <div key={e.id} className="plx-mailrow">
            <Switch label={e.title} help={e.when} checked={v.flags[e.id]} onChange={(c) => setFlag(e.id, c)} />
            <Button size="sm" variant={preview === e.id ? "primary" : "ghost"} leftIcon={<Eye size={16} aria-hidden />} aria-pressed={preview === e.id} onClick={() => setPreview(e.id)}>See an example</Button>
          </div>
        ))}
      </Group>

      <Group title="What it looks like" help="An example with made-up details. Each customer sees their own name, order and items.">
        <div className="plx-mail" aria-label={`Example email: ${EMAIL_EVENTS.find((e) => e.id === preview)?.title}`}>
          <div className="plx-mail__subj">{ex.subject}</div>
          <pre className="plx-mail__body" style={{ opacity: on ? 1 : 0.5 }}>{ex.body}</pre>
        </div>
        {!on ? <p className="plx-small" style={{ margin: 0 }}>This email is switched off, so customers won&apos;t get it.</p> : null}
      </Group>

      <Group title="Your mailing list" help="Add the people who buy from you, or sign up on your site, to your own email list with MailDrip." status={connected ? <Badge tone="success" dot>Connected</Badge> : <Badge>Not connected</Badge>}>
        {!connected ? (
          <MailingConnect templateId={templateId} onConnected={() => { setConnected(true); router.refresh(); }} />
        ) : (
          <>
            <div className="plx-inlinemsg"><span><CircleCheck size={16} aria-hidden style={{ verticalAlign: "-3px" }} /> MailDrip is connected. Choose where people are added below, then save.</span></div>
            {groupsError ? <div className="plx-inlinemsg plx-inlinemsg--bad" role="alert">{groupsError}</div> : null}
            <GroupPicker label="People who buy from you" help="Added automatically after a paid order." templateId={templateId} groups={groups} value={v.paid} onChange={(id) => form.patch({ paid: id })} onCreated={(g) => setGroups((p) => (p ? [...p, g] : [g]))} />
            <GroupPicker label="People who sign up for news" help="For your sign-up form and popup. Anyone can join, even without buying." templateId={templateId} groups={groups} value={v.news} onChange={(id) => form.patch({ news: id })} onCreated={(g) => setGroups((p) => (p ? [...p, g] : [g]))} />
            <Switch label="Show a sign-up popup on my site" help={v.news ? "Appears after a few seconds or when someone is about to leave. If they close it, we don't ask again for 30 days." : "Choose a list for news sign-ups above first."} checked={v.popup && !!v.news} disabled={!v.news} onChange={(popup) => form.patch({ popup })} />
            <div><Button variant="ghost" loading={disconnecting} onClick={disconnect}>Disconnect MailDrip</Button></div>
          </>
        )}
      </Group>
      <SaveBar form={form} />
    </div>
  );
}
