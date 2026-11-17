"use client";

import "./emails.css";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clipboard, Copy, Info, Mail, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Button, ButtonLink, Input, Modal, useToast } from "../ui";
import { errMsg, hubApi } from "../hub/hubApi";
import { EmailChoices, NewEmailDialog, type EmailStart, type ReadyMadeEmail } from "./NewEmailDialog";
import { editedLabel, emailUsage, filterEmails } from "@/lib/dashboardV3/emails";
import type { EmailCard } from "@/lib/dashboardV3/emailsData";

const FRAME_W = 640;

/** The email's real look, shrunk to fit its card. Sandboxed: scripts in an email never run here. */
function Thumb({ html, name }: { html: string; name: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [scale, setScale] = useState(0.4);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / FRAME_W);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <span ref={ref} className="plx-ecard__thumb">
      {html ? <iframe className="plx-ecard__frame" title={`Preview of ${name}`} srcDoc={html} sandbox="" tabIndex={-1} loading="lazy" style={{ transform: `scale(${scale})` }} /> : <span className="plx-ecard__ph"><Mail size={44} aria-hidden /></span>}
    </span>
  );
}

export function EmailsLibrary({ initial, limit, planName, canUpgrade = true, designs, preview, openNew, startWith }: {
  initial: EmailCard[];
  limit: number;
  planName: string;
  canUpgrade?: boolean;
  designs?: ReadyMadeEmail[];
  preview?: boolean;
  openNew?: boolean;
  /** Which step the dialog opens on (preview and links only). */
  startWith?: EmailStart;
}) {
  const router = useRouter();
  const toast = useToast();
  const [emails, setEmails] = useState(initial);
  useEffect(() => setEmails(initial), [initial]);
  const [q, setQ] = useState("");
  const [dialog, setDialog] = useState(!!openNew);
  const [start, setStart] = useState<EmailStart>(startWith ?? "choose");
  const openDialog = (s: EmailStart = "choose") => {
    setStart(s);
    setDialog(true);
  };
  const [deleting, setDeleting] = useState<EmailCard | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const usage = emailUsage(emails.length, limit);
  const shown = useMemo(() => filterEmails(emails, q), [emails, q]);

  async function duplicate(e: EmailCard) {
    if (usage.atLimit) return openDialog();
    setBusy(e.id);
    try {
      if (preview) return toast.show({ title: "Copy made", tone: "success" });
      await hubApi(`/api/templates/${e.id}/duplicate-site`, { method: "POST" });
      toast.show({ title: "Copy made", tone: "success" });
      router.refresh();
    } catch (err) {
      toast.show({ title: "We couldn't copy it", description: errMsg(err), tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(deleting.id);
    try {
      if (!preview) await hubApi(`/api/templates/${deleting.id}`, { method: "DELETE" });
      setEmails((all) => all.filter((x) => x.id !== deleting.id));
      toast.show({ title: `“${deleting.name}” deleted`, tone: "success" });
      setDeleting(null);
      if (!preview) router.refresh();
    } catch (err) {
      toast.show({ title: "We couldn't delete it", description: errMsg(err), tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  async function copyCode(e: EmailCard) {
    try {
      await navigator.clipboard.writeText(e.html);
      toast.show({ title: "Copied", description: "Paste it into your email tool.", tone: "success" });
    } catch {
      toast.show({ title: "Couldn't copy", description: "Open the email and copy it from there.", tone: "danger" });
    }
  }

  const add = <Button leftIcon={<Plus size={18} aria-hidden />} onClick={() => openDialog()} data-tour="emails-new">New email</Button>;

  return (
    <div className="plx-page plx-em" data-tour="emails-main">
      <header className="plx-em__head">
        <div>
          <h1 className="plx-h1">Emails</h1>
          <p className="plx-body" style={{ margin: "6px 0 0", color: "var(--plx-muted)" }}>Your email designs, ready to use.</p>
        </div>
        {emails.length > 0 ? add : null}
      </header>

      <div className="plx-em__note" role="note">
        <Info size={20} aria-hidden />
        <span>Design emails here. Plexo doesn&apos;t send them for you. Use them with your own email tool.</span>
      </div>

      <div className="plx-em__bar">
        <div className="plx-emmeter" data-state={usage.atLimit ? "full" : usage.nearLimit ? "near" : "ok"}>
          <div className="plx-emmeter__top"><b>{usage.label}</b><span>{planName} plan</span></div>
          <div className="plx-emmeter__track" role="progressbar" aria-label="Emails used" aria-valuemin={0} aria-valuemax={usage.limit} aria-valuenow={usage.used} aria-valuetext={usage.label}><div className="plx-emmeter__fill" style={{ width: `${usage.percent}%` }} /></div>
        </div>
        {emails.length > 0 ? (
          <div className="plx-emsearch" style={{ flex: "1 1 240px" }}>
            <Search size={18} aria-hidden />
            <Input hideLabel label="Search emails" placeholder="Search your emails" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        ) : null}
      </div>

      {usage.atLimit && canUpgrade ? (
        <div className="plx-nudge">
          <p><b>You&apos;ve used all {usage.limit} email{usage.limit === 1 ? "" : "s"} on your {planName} plan.</b> Move up to make more, or delete one you no longer need.</p>
          <ButtonLink href="/dashboard/settings/plan">See plans</ButtonLink>
        </div>
      ) : null}

      {emails.length === 0 ? (
        <section className="plx-em__first" aria-labelledby="em-first">
          <div>
            <h2 id="em-first" className="plx-h2">Make your first email</h2>
            <p className="plx-body" style={{ margin: "6px 0 0", color: "var(--plx-muted)" }}>A welcome email, a receipt or a newsletter. How would you like to start?</p>
          </div>
          <EmailChoices onBlank={() => openDialog("blank")} onDesign={() => openDialog("design")} />
        </section>
      ) : shown.length === 0 ? (
        <p className="plx-small">No emails match “{q}”.</p>
      ) : (
        <ul className="plx-egrid" style={{ listStyle: "none", margin: 0, padding: 0 }} data-testid="email-grid">
          {shown.map((e) => (
            <li key={e.id} className="plx-ecard">
              <Link href={`/dashboard/templates/${e.id}`} aria-label={`Edit ${e.name}`} style={{ display: "contents" }}><Thumb html={e.html} name={e.name} /></Link>
              <div className="plx-ecard__body">
                <span className="plx-ecard__name" title={e.name}>{e.name}</span>
                <span className="plx-ecard__meta">{editedLabel(e.updatedAt)}</span>
              </div>
              <div className="plx-ecard__acts">
                <ButtonLink href={`/dashboard/templates/${e.id}`} size="sm" leftIcon={<Pencil size={16} aria-hidden />}>Edit</ButtonLink>
                <Button size="sm" variant="secondary" iconOnly aria-label={`Make a copy of ${e.name}`} loading={busy === e.id} onClick={() => duplicate(e)}><Copy size={16} aria-hidden /></Button>
                <Button size="sm" variant="secondary" iconOnly aria-label={`Copy ${e.name} for my email tool`} disabled={!e.html} onClick={() => copyCode(e)}><Clipboard size={16} aria-hidden /></Button>
                <span className="plx-grow" />
                <Button size="sm" variant="ghost" iconOnly aria-label={`Delete ${e.name}`} onClick={() => setDeleting(e)}><Trash2 size={16} aria-hidden /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {emails.length > 0 ? <p className="plx-small">To use one: open it, or tap the clipboard to copy it, then paste it into your email tool.</p> : null}

      <NewEmailDialog start={start} open={dialog} onClose={() => setDialog(false)} usage={usage} designs={designs} preview={preview} />
      <Modal open={!!deleting} onClose={() => setDeleting(null)} title={deleting ? `Delete “${deleting.name}”?` : ""} description="This can't be undone. Emails you already sent from your email tool aren't affected." footer={<><Button variant="secondary" onClick={() => setDeleting(null)}>Keep it</Button><Button variant="danger" loading={!!busy} onClick={remove}>Delete email</Button></>} />
    </div>
  );
}
