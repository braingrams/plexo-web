"use client";

import { useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import { Badge, Button, ButtonLink, Card, CardHeader, Input, Notice, Select, Skeleton } from "@/app/dashboard/_v3/ui";

// "Where messages go": every message lands in the inbox and is emailed to the owner. Each form can also add the sender to a MailDrip list
// and/or send the message to a webhook (Zapier, Make, a CRM), and carry a verification box. All of that is tucked behind "Settings" per
// form, so the page stays calm for the many owners who never need it.

type Form = {
  formName: string;
  maildripGroupId: string | null;
  maildripGroupTitle: string | null;
  webhookUrl: string | null;
  redirectUrl: string | null;
  source: string | null;
  note: string | null;
  captcha: { provider: "turnstile" | "recaptcha" | "hcaptcha"; siteKey: string; active: boolean } | null;
  lastDeliveredAt: string | null;
  lastDeliveryError: string | null;
};
type Overview = { forms: Form[]; maildrip: { connected: boolean; groups: { id: string; title: string; totalContacts: number }[]; error: string | null } };

/** How many forms show before "Show all": a site can have ten or more, and they should never push the messages off the screen. */
export const FORMS_SHOWN_FIRST = 3;

export function FormDestinationsClient({ templateId }: { templateId: string }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  function load() {
    fetch(`/api/v1/templates/${templateId}/form-settings`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "We couldn't load your forms.");
        setData(body);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "We couldn't load your forms."));
  }
  useEffect(load, [templateId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <Notice kind="error" title="We couldn't load your forms">{error}</Notice>;
  if (!data) return <Card><Skeleton height={56} /></Card>;
  if (data.forms.length === 0) return null;

  return (
    <Card data-testid="form-destinations">
      <CardHeader title="Where messages go" description="Every message shows up in the inbox below and is emailed to you. Plexo checks every form for spam and bots, with nothing for visitors to tick. Open a form's settings to add a verification box, add senders to a list or pass messages on to another tool." action={<ButtonLink href="/dashboard/settings/notifications" variant="secondary" size="sm">Change where emails go</ButtonLink>} />
      {data.maildrip.error ? <Notice kind="warning" title="MailDrip isn't responding">{data.maildrip.error}</Notice> : null}
      <div>
        {(showAll ? data.forms : data.forms.slice(0, FORMS_SHOWN_FIRST)).map((form) => <FormRow key={form.formName} templateId={templateId} form={form} overview={data} onSaved={load} />)}
      </div>
      {data.forms.length > FORMS_SHOWN_FIRST ? (
        <div style={{ marginTop: 12 }}>
          <Button variant="secondary" size="sm" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show fewer forms" : `Show all ${data.forms.length} forms`}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function FormRow({ templateId, form, overview, onSaved }: { templateId: string; form: Form; overview: Overview; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [groupId, setGroupId] = useState(form.maildripGroupId ?? "");
  const [webhook, setWebhook] = useState(form.webhookUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [captchaOpen, setCaptchaOpen] = useState(Boolean(form.captcha));
  const [provider, setProvider] = useState<string>(form.captcha?.provider ?? "turnstile");
  const [siteKey, setSiteKey] = useState(form.captcha?.siteKey ?? "");
  const [secretKey, setSecretKey] = useState("");
  const captchaDirty = captchaOpen && (secretKey.trim() !== "" || provider !== (form.captcha?.provider ?? "turnstile") || siteKey.trim() !== (form.captcha?.siteKey ?? ""));
  const dirty = groupId !== (form.maildripGroupId ?? "") || webhook !== (form.webhookUrl ?? "") || captchaDirty;
  const unknownGroup = form.maildripGroupId && !overview.maildrip.groups.some((g) => g.id === form.maildripGroupId);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/templates/${templateId}/form-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formName: form.formName, maildripGroupId: groupId || null, webhookUrl: webhook.trim() || null, ...(captchaDirty ? { captcha: { provider, siteKey: siteKey.trim(), secretKey: secretKey.trim() || undefined } } : {}) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "We couldn't save that.");
      setSecretKey("");
      setMessage({ tone: "success", text: "Saved. New messages follow this from now on." });
      onSaved();
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "We couldn't save that." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="plx-forms__row">
      <div className="plx-forms__name">
        <b>{form.formName}</b>
        <div className="plx-forms__chips">
          <Badge tone="success">Emailed to you</Badge>
          <Badge tone="neutral">Spam check on</Badge>
          {form.maildripGroupId ? <Badge tone="info">Added to your mailing list</Badge> : null}
          {form.webhookUrl ? <Badge tone="info">Sent to another tool</Badge> : null}
          {form.captcha?.active ? <Badge tone="neutral">Verification box on</Badge> : null}
          {form.lastDeliveryError ? <Badge tone="warning">A delivery needs attention</Badge> : null}
        </div>
      </div>
      <Button variant="secondary" size="sm" leftIcon={<Settings2 size={15} aria-hidden />} aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? "Hide settings" : "Settings"}</Button>

      {open ? (
        <div className="plx-forms__more plx-adv__stack">
          <div className="plx-adv__grid2">
            <Select
              label="Add senders to your mailing list"
              value={groupId}
              disabled={!overview.maildrip.connected && !groupId}
              onChange={(e) => setGroupId(e.target.value)}
              help={overview.maildrip.connected ? "Each person who fills in this form is added to the list you choose in MailDrip." : "Your mailing lists live in MailDrip. Connect your MailDrip account to choose one."}
              options={[
                { value: "", label: overview.maildrip.connected ? "Don't add to a list" : "No mailing list connected" },
                ...(unknownGroup ? [{ value: form.maildripGroupId!, label: `${form.maildripGroupTitle ?? "List from WordPress"} (not found, pick again)` }] : []),
                ...overview.maildrip.groups.map((g) => ({ value: g.id, label: `${g.title} (${g.totalContacts.toLocaleString()})` })),
              ]}
            />
            <Input label="Also send each message to another tool" optional help="A web address from Zapier, Make or your CRM" value={webhook} onChange={(e) => setWebhook(e.target.value)} placeholder="https://hooks.zapier.com/…" />
          </div>
          {!overview.maildrip.connected ? <div><ButtonLink href={`/dashboard/commerce/${templateId}/settings/notifications`} variant="secondary" size="sm">Connect my MailDrip account</ButtonLink></div> : null}

          {form.captcha && !form.captcha.active ? (
            <Notice kind="warning" title="Switch the verification box back on">
              This form had a verification box before. Paste your secret key below to turn it on again. Until then Plexo&rsquo;s built-in spam filter protects it.
            </Notice>
          ) : null}
          {captchaOpen ? (
            <div className="plx-adv__stack">
              <div className="plx-adv__grid2">
                <Select label="Verification box" value={provider} onChange={(e) => setProvider(e.target.value)} options={[{ value: "turnstile", label: "Cloudflare Turnstile" }, { value: "recaptcha", label: "Google reCAPTCHA" }, { value: "hcaptcha", label: "hCaptcha" }]} />
                <Input label="Site key" help="The public key from that service" value={siteKey} onChange={(e) => setSiteKey(e.target.value)} />
                <Input fieldClassName="plx-adv__span2" label="Secret key" help={form.captcha?.active ? "Saved. Leave empty to keep it." : "The private key from that service"} type="password" autoComplete="off" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} placeholder={form.captcha?.active ? "••••••••" : "Paste your secret key"} />
              </div>
            </div>
          ) : (
            <div><Button variant="secondary" size="sm" onClick={() => setCaptchaOpen(true)}>Add a verification box for extra protection</Button></div>
          )}

          {form.redirectUrl ? <p className="plx-small" style={{ margin: 0 }}>After sending, visitors go to <b>{form.redirectUrl}</b>.</p> : null}
          {form.note ? <p className="plx-small" style={{ margin: 0 }}>{form.note}</p> : null}
          {form.lastDeliveryError ? <Notice kind="warning" title="The last delivery had a problem">{form.lastDeliveryError}</Notice> : form.lastDeliveredAt ? <p className="plx-small" style={{ margin: 0 }}>Last passed on {new Date(form.lastDeliveredAt).toLocaleString()}.</p> : null}
          {message ? <Notice kind={message.tone} title={message.text} /> : null}
          <div className="plx-adv__actions"><Button loading={saving} disabled={!dirty} onClick={() => void save()}>Save</Button></div>
        </div>
      ) : null}
    </div>
  );
}
