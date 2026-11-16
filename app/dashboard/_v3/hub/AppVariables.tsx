"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardHeader, Input, Select, Skeleton, useToast } from "../ui";
import { ENV_NAME, isPublicName } from "@/lib/dashboardV3/hubApp";
import { errMsg, hubApi } from "./hubApi";

type Scope = "all" | "dev" | "live";
type Variable = { name: string; scope: Scope; value: string; buildTime: boolean };
type Secret = { name: string; scope: Scope; hint: string | null };
const SCOPES: { value: Scope; label: string }[] = [{ value: "all", label: "Preview and live" }, { value: "dev", label: "Preview only" }, { value: "live", label: "Live only" }];
const scopeLabel = (s: Scope) => SCOPES.find((x) => x.value === s)?.label ?? s;

/** Settings and passwords your app reads (like an API key). Settings are shown; passwords are saved but never shown again. */
export function AppVariables({ siteId, onRebuild }: { siteId: string; onRebuild: () => void }) {
  const { show } = useToast();
  const base = `/api/v1/templates/${siteId}`;
  const [vars, setVars] = useState<Variable[] | null>(null);
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [needsRebuild, setNeedsRebuild] = useState(false);
  const [locked, setLocked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [add, setAdd] = useState<null | "variable" | "secret">(null);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [v, s] = await Promise.all([hubApi<{ variables: Variable[] }>(`${base}/ssr-variables`), hubApi<{ secrets: Secret[]; needsRebuild: boolean }>(`${base}/ssr-secrets`)]);
      setVars(v.variables);
      setSecrets(s.secrets);
      setNeedsRebuild(s.needsRebuild);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 403) setLocked(errMsg(e));
      else setError(errMsg(e, "We couldn't load your app's settings."));
      setVars([]);
    }
  }, [base]);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!ENV_NAME.test(name)) return setError("Use capital letters, numbers and underscores, like STRIPE_KEY. It has to start with a letter.");
    if (!value) return setError("Type the value.");
    setBusy(true);
    setError(null);
    try {
      if (add === "variable") await hubApi(`${base}/ssr-variables`, { method: "PUT", json: { name, value, scope, buildTime: isPublicName(name) } }, "We couldn't save that setting.");
      else await hubApi(`${base}/ssr-secrets`, { method: "PUT", json: { name, value, scope } }, "We couldn't save that password.");
      show({ title: add === "variable" ? "Setting saved" : "Password saved", description: "Rebuild your app to use it.", tone: "success" });
      setAdd(null); setName(""); setValue("");
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove(kind: "variable" | "secret", n: string, sc: Scope) {
    if (!window.confirm(`Remove ${n}? Your app won't be able to read it after the next rebuild.`)) return;
    try {
      await hubApi(`${base}/${kind === "variable" ? "ssr-variables" : "ssr-secrets"}?name=${encodeURIComponent(n)}&scope=${sc}`, { method: "DELETE" });
      await load();
    } catch (e) {
      show({ title: errMsg(e), tone: "danger" });
    }
  }

  if (!vars) return <Card><Skeleton height={20} width="40%" style={{ marginBottom: 12 }} /><Skeleton height={56} /></Card>;
  if (locked) return <Card><CardHeader title="Settings and passwords" description={locked} /></Card>;
  return (
    <Card data-tour="hub-app-env">
      <CardHeader title="Settings and passwords" description="Things your app needs, like an API key. Passwords are saved safely and never shown again." />
      <div className="plx-hub__actions" style={{ marginBottom: 14 }}><Button variant="secondary" size="sm" leftIcon={<Plus size={16} aria-hidden />} onClick={() => { setAdd("variable"); setError(null); }}>Add a setting</Button><Button variant="secondary" size="sm" leftIcon={<KeyRound size={16} aria-hidden />} onClick={() => { setAdd("secret"); setError(null); }}>Add a password</Button></div>
      {needsRebuild ? <div className="plx-inlinemsg plx-inlinemsg--warn" style={{ marginBottom: 14 }}><span>A password changed. Rebuild to use it.</span><Button size="sm" variant="secondary" onClick={onRebuild} style={{ marginInlineStart: "auto" }}>Rebuild now</Button></div> : null}
      {vars.length + secrets.length === 0 && !add ? <p className="plx-body">Nothing added yet. Most apps don&apos;t need anything here.</p> : null}
      <ul className="plx-list">
        {vars.map((v) => (
          <li key={`v:${v.scope}:${v.name}`} className="plx-row plx-envrow">
            <span className="plx-row__main"><span className="plx-row__title plx-mono">{v.name}</span><span className="plx-row__sub">{v.value} · {scopeLabel(v.scope)}</span></span>
            <span className="plx-row__end">{v.buildTime || isPublicName(v.name) ? <Badge tone="info">Visitors can read it</Badge> : null}<Button variant="ghost" size="sm" iconOnly aria-label={`Remove ${v.name}`} onClick={() => remove("variable", v.name, v.scope)}><Trash2 size={18} aria-hidden /></Button></span>
          </li>
        ))}
        {secrets.map((s) => (
          <li key={`s:${s.scope}:${s.name}`} className="plx-row plx-envrow">
            <span className="plx-row__main"><span className="plx-row__title plx-mono">{s.name}</span><span className="plx-row__sub">Password{s.hint ? ` ending ${s.hint}` : ""} · {scopeLabel(s.scope)}</span></span>
            <span className="plx-row__end"><Button variant="ghost" size="sm" iconOnly aria-label={`Remove ${s.name}`} onClick={() => remove("secret", s.name, s.scope)}><Trash2 size={18} aria-hidden /></Button></span>
          </li>
        ))}
      </ul>
      {add ? (
        <div className="plx-form" style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--plx-border)" }}>
          <b>{add === "variable" ? "Add a setting" : "Add a password"}</b>
          <div className="plx-form__two">
            <Input label="Name" value={name} onChange={(e) => setName(e.target.value.toUpperCase())} placeholder="STRIPE_KEY" autoComplete="off" />
            <Select label="Used in" value={scope} onChange={(e) => setScope(e.target.value as Scope)} options={SCOPES} />
          </div>
          <Input label={add === "variable" ? "Value" : "Password or key"} type={add === "secret" ? "password" : "text"} value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" />
          {add === "variable" && isPublicName(name) ? <p className="plx-small">Names starting like this are built into your app, so visitors can read them. Don&apos;t put anything private here.</p> : null}
          {error ? <p className="plx-field__error" role="alert">{error}</p> : null}
          <div className="plx-hub__actions"><Button loading={busy} onClick={save}>Save</Button><Button variant="ghost" onClick={() => setAdd(null)}>Cancel</Button></div>
        </div>
      ) : error ? <p className="plx-field__error" role="alert">{error}</p> : null}
    </Card>
  );
}
