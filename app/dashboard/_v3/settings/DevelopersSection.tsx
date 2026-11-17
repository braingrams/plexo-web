"use client";

import { useState } from "react";
import { Check, Code2, KeyRound, Trash2, Wrench } from "lucide-react";
import { Badge, Button, ButtonLink, Textarea } from "../ui";
import { usageMeter } from "@/lib/dashboardV3/settingsUsage";
import { errMsg, hubApi } from "../hub/hubApi";
import { DEVELOPER_EDITOR_CARD } from "@/lib/promos/promos";
import { SDK_V2_INSTALL, SDK_V2_EMBED } from "@/lib/sdk/v2-snippets";
import { AsideCard, CopyBox, Notice, Panel, SettingsPageShell, ToggleRow, UsageMeter } from "./bits";

export type DevKey = { id: string; name: string; maskedKey: string; createdAt: string };

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** The one place technical words are allowed: API keys, the SDK, compiling and embedding. */
export function DevelopersSection({ keys: k0, maxKeys, canPublishViaApi, publishViaApi: p0, canCompile, mock = false }: { keys: DevKey[]; maxKeys: number; canPublishViaApi: boolean; publishViaApi: boolean; canCompile: boolean; mock?: boolean }) {
  const [keys, setKeys] = useState(k0);
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publish, setPublish] = useState(p0);
  const [mjml, setMjml] = useState("<mjml>\n  <mj-body>\n    <mj-section>\n      <mj-column>\n        <mj-text>Hello from Plexo</mj-text>\n      </mj-column>\n    </mj-section>\n  </mj-body>\n</mjml>");
  const [html, setHtml] = useState("");

  async function create() {
    setBusy("create");
    setError(null);
    try {
      if (mock) {
        setKeys((p) => [{ id: `k${Date.now()}`, name: "New key", maskedKey: "plexo_sk_••••a1b2", createdAt: new Date().toISOString() }, ...p]);
        setFresh("plexo_sk_example_key_shown_once");
      } else {
        const d = await hubApi<{ apiKey: DevKey; rawKey: string }>("/api/settings/api-keys", { method: "POST", json: {} }, "We couldn't make a new key. Please try again.");
        setKeys((p) => [d.apiKey, ...p]);
        setFresh(d.rawKey);
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function revoke(id: string) {
    if (!window.confirm("Revoke this key? Anything using it will stop working straight away.")) return;
    setBusy(id);
    try {
      if (!mock) await hubApi(`/api/settings/api-keys/${id}`, { method: "PATCH", json: { action: "revoke" } }, "We couldn't revoke that key.");
      setKeys((p) => p.filter((x) => x.id !== id));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function togglePublish(next: boolean) {
    setPublish(next);
    try {
      if (!mock) await hubApi("/api/profile", { method: "PATCH", json: { manageLandingPagePublishing: next } }, "We couldn't save that setting.");
    } catch (e) {
      setPublish(!next);
      setError(errMsg(e));
    }
  }

  async function compile() {
    setBusy("compile");
    setError(null);
    try {
      if (mock) setHtml("<!doctype html>\n<html>…compiled HTML appears here…</html>");
      else {
        const d = await hubApi<{ html?: string }>("/api/v1/compile", { method: "POST", json: { mjml }, headers: { "x-api-key": "workspace-internal" } }, "Compile failed. Check the markup and try again.");
        setHtml(d.html ?? "");
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const meter = usageMeter(keys.length, maxKeys);
  return (
    <SettingsPageShell
      title="Developers"
      purpose="API keys, the SDK, and tools for putting Plexo inside your own apps."
      action={<Button loading={busy === "create"} disabled={keys.length >= maxKeys} leftIcon={<KeyRound size={16} aria-hidden />} onClick={create}>New API key</Button>}
      aside={
        <>
          {/* Always here, even if the dashboard strip was closed or never switched on. */}
          <AsideCard title={DEVELOPER_EDITOR_CARD.title} icon={Code2}>
            <p>{DEVELOPER_EDITOR_CARD.body}</p>
            <Button variant="secondary" size="sm" onClick={() => document.querySelector('[data-tour="dev-sdk"]')?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              {DEVELOPER_EDITOR_CARD.button}
            </Button>
          </AsideCard>
          <AsideCard title="Your keys" icon={KeyRound}>
            <UsageMeter label="API keys" meter={meter} hint={meter.tone === "full" ? "You've used them all. Revoke one to make another." : "Each key can be revoked on its own."} />
          </AsideCard>
          <AsideCard title="More tools" icon={Wrench}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
              <ButtonLink href="/dashboard/settings/ai" variant="link">AI for your sites and apps</ButtonLink>
              <ButtonLink href="/dashboard/settings/github" variant="link">Connect your code account</ButtonLink>
              <ButtonLink href="/dashboard/settings/email-log" variant="link">Emails we sent for you</ButtonLink>
            </div>
          </AsideCard>
          <AsideCard title="Good to know">
            <ul>
              <li><Check size={16} aria-hidden /> <span>A new key is shown once. Copy it straight away.</span></li>
              <li><Check size={16} aria-hidden /> <span>Revoking a key stops anything using it, immediately.</span></li>
              <li><Check size={16} aria-hidden /> <span>Prefer not to code? The AI tools tab connects Claude and ChatGPT with a link.</span></li>
            </ul>
          </AsideCard>
        </>
      }
    >
      {error ? <Notice tone="bad">{error}</Notice> : null}

      <Panel title="API keys" description={`Authenticate requests to the Plexo API. ${keys.length} of ${maxKeys} in use.`} flush data-tour="dev-keys">
        {fresh ? (
          <div className="plx-dev" style={{ padding: "0 28px 24px" }}>
            <Notice tone="warn">Copy this key now. For your security it won&apos;t be shown again.</Notice>
            <CopyBox value={fresh} label="New API key" wrap />
            <div><Button variant="secondary" size="sm" onClick={() => setFresh(null)}>I&apos;ve copied it</Button></div>
          </div>
        ) : null}
        {keys.length === 0 ? (
          <p className="plx-body" style={{ padding: "0 28px 28px" }}>No keys yet. Make one to use the API or the SDK.</p>
        ) : (
          keys.map((key) => (
            <div key={key.id} className="plx-keyrow">
              <span className="plx-tile"><KeyRound size={18} aria-hidden /></span>
              <div className="plx-person__main">
                <code>{key.maskedKey}</code>
                <span>Created {day(key.createdAt)}</span>
              </div>
              <Button variant="ghost" size="sm" loading={busy === key.id} leftIcon={<Trash2 size={16} aria-hidden />} onClick={() => revoke(key.id)}>Revoke</Button>
            </div>
          ))
        )}
      </Panel>

      <Panel title="SDK" description="Put the Plexo builder inside your own product." data-tour="dev-sdk">
        <div className="plx-dev">
          <CopyBox value={SDK_V2_INSTALL} label="Install command" wrap />
          <pre className="plx-code" style={{ maxHeight: 260 }}>{SDK_V2_EMBED}</pre>
          {canPublishViaApi ? <ToggleRow title="Let my apps publish pages" description="Embedded builders publish under your account, with no per-domain limit." checked={publish} onChange={togglePublish} /> : <Badge tone="neutral">Publishing from embedded builders is on the Pro plan</Badge>}
        </div>
      </Panel>

      <Panel title="Compile MJML" description={canCompile ? "Turn MJML into responsive HTML." : "Available on paid plans."} data-tour="dev-compile">
        <div className="plx-dev">
          <Textarea label="MJML" className="plx-textarea-code" value={mjml} onChange={(e) => setMjml(e.target.value)} disabled={!canCompile} />
          <div><Button variant="secondary" loading={busy === "compile"} disabled={!canCompile || !mjml.trim()} onClick={compile}>Compile</Button></div>
          {html ? <pre className="plx-code plx-code--wrap" style={{ maxHeight: 220 }}>{html}</pre> : null}
        </div>
      </Panel>
    </SettingsPageShell>
  );
}
