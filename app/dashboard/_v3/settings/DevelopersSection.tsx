"use client";

import { useState } from "react";
import { KeyRound, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardHeader, Textarea } from "../ui";
import { errMsg, hubApi } from "../hub/hubApi";
import { SDK_V2_INSTALL, SDK_V2_EMBED } from "@/lib/sdk/v2-snippets";
import { CopyBox, Notice, SectionHead, ToggleRow } from "./bits";

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

  return (
    <>
      <SectionHead title="Developers">API keys, the SDK, and tools for embedding Plexo in your own apps.</SectionHead>
      {error ? <Notice tone="bad">{error}</Notice> : null}

      <Card data-tour="dev-keys">
        <CardHeader title="API keys" description={`Authenticate requests to the Plexo API. ${keys.length} of ${maxKeys} in use.`} action={<Button size="sm" loading={busy === "create"} disabled={keys.length >= maxKeys} leftIcon={<KeyRound size={16} aria-hidden />} onClick={create}>New key</Button>} />
        {fresh ? (
          <div className="plx-dev" style={{ marginBottom: 20 }}>
            <Notice tone="warn">Copy this key now. For your security it won&apos;t be shown again.</Notice>
            <CopyBox value={fresh} label="New API key" wrap />
            <div><Button variant="ghost" size="sm" onClick={() => setFresh(null)}>I&apos;ve copied it</Button></div>
          </div>
        ) : null}
        {keys.length === 0 ? (
          <p className="plx-body" style={{ margin: 0 }}>No keys yet. Make one to use the API or the SDK.</p>
        ) : (
          <ul className="plx-list" style={{ margin: "0 -20px" }}>
            {keys.map((key) => (
              <li key={key.id} className="plx-row">
                <div className="plx-row__main">
                  <span className="plx-row__title" style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)" }}>{key.maskedKey}</span>
                  <span className="plx-row__sub">Created {day(key.createdAt)}</span>
                </div>
                <Button variant="ghost" size="sm" loading={busy === key.id} leftIcon={<Trash2 size={16} aria-hidden />} onClick={() => revoke(key.id)}>Revoke</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="plx-set__grid">
        <Card data-tour="dev-sdk">
          <CardHeader title="SDK" description="Put the Plexo builder inside your own product." />
          <div className="plx-dev">
            <CopyBox value={SDK_V2_INSTALL} label="Install command" wrap />
            <pre className="plx-code" style={{ maxHeight: 260 }}>{SDK_V2_EMBED}</pre>
            {canPublishViaApi ? <ToggleRow title="Let my apps publish pages" description="Embedded builders publish under your account, with no per-domain limit." checked={publish} onChange={togglePublish} /> : <Badge tone="neutral">Publishing from embedded builders is on the Pro plan</Badge>}
          </div>
        </Card>

        <Card data-tour="dev-compile">
          <CardHeader title="Compile MJML" description={canCompile ? "Turn MJML into responsive HTML." : "Available on paid plans."} />
          <div className="plx-dev">
            <Textarea label="MJML" className="plx-textarea-code" value={mjml} onChange={(e) => setMjml(e.target.value)} disabled={!canCompile} />
            <div><Button variant="secondary" loading={busy === "compile"} disabled={!canCompile || !mjml.trim()} onClick={compile}>Compile</Button></div>
            {html ? <pre className="plx-code plx-code--wrap" style={{ maxHeight: 220 }}>{html}</pre> : null}
          </div>
        </Card>
      </div>
    </>
  );
}
