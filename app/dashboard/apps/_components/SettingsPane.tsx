"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink, Globe, Plus, Trash2 } from "lucide-react";
import { api, appsApi, ApiError, type AppSummary } from "./api";
import { Button, C, Notice, Panel, inputStyle } from "./ui";

type Access = "public" | "private";
type Settings = {
  auth: {
    password: boolean;
    magicLink: boolean;
    google: boolean;
    googleClientId: string | null;
    hasGoogleClientSecret: boolean;
    usesPlexoGoogleClient: boolean;
    requireEmailConfirmation: boolean;
    allowSignups: boolean;
    emailFromName: string | null;
    extraRedirectOrigins: string[];
  };
  buckets: Record<string, { access: Access; maxBytes?: number }>;
  requestsPerMinute: number;
};
type AuthToggle = "password" | "magicLink" | "google" | "requireEmailConfirmation" | "allowSignups";
type BucketDraft = { key: string; name: string; access: Access; maxMb: string };

const MB = 1024 * 1024;
const BUCKET_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
const errText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
const defaultAccess = (name: string): Access => (["avatars", "images", "media"].includes(name) || name.startsWith("public-") ? "public" : "private");

function toDrafts(buckets: Settings["buckets"]): BucketDraft[] {
  return Object.entries(buckets).map(([name, b]) => ({ key: name, name, access: b.access, maxMb: b.maxBytes ? String(Math.round((b.maxBytes / MB) * 10) / 10) : "" }));
}

export function SettingsPane({ appId, summary, onRenamed }: { appId: string; summary: AppSummary | null; onRenamed?: (name: string) => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: { cancelled: boolean }) => {
      try {
        const s = await api<Settings>(`/api/v1/apps/${appId}/settings`);
        if (!signal?.cancelled) {
          setSettings(s);
          setLoadError(null);
        }
      } catch (err) {
        if (!signal?.cancelled) setLoadError(errText(err, "Couldn't load settings."));
      }
    },
    [appId],
  );

  useEffect(() => {
    const signal = { cancelled: false };
    void load(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [load]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem", padding: "1rem", maxWidth: 820 }}>
      <NameSection appId={appId} summary={summary} onRenamed={onRenamed} />
      {loadError && !settings && (
        <Notice tone="danger">
          {loadError}{" "}
          <button type="button" onClick={() => void load()} style={linkButton}>
            Try again
          </button>
        </Notice>
      )}
      {!settings && !loadError && <p style={{ margin: 0, fontSize: "0.8rem", color: C.muted }}>Loading settings…</p>}
      {settings && (
        <>
          <SignInSection appId={appId} summary={summary} settings={settings} onSaved={setSettings} />
          <BucketsSection appId={appId} settings={settings} onSaved={setSettings} />
        </>
      )}
      <DomainsSection summary={summary} />
      <DangerZone appId={appId} summary={summary} />
    </div>
  );
}

// ------------------------------------------------------------------ name

function NameSection({ appId, summary, onRenamed }: { appId: string; summary: AppSummary | null; onRenamed?: (name: string) => void }) {
  const [name, setName] = useState(summary?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const id = useId();

  useEffect(() => {
    if (summary?.name) setName(summary.name);
  }, [summary?.name]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError("Give the app a name.");
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await appsApi.rename(appId, trimmed);
      setName(res.name);
      setSaved(true);
      onRenamed?.(res.name);
    } catch (err) {
      setError(errText(err, "Couldn't rename the app."));
    } finally {
      setSaving(false);
    }
  };

  const unchanged = !summary || name.trim() === summary.name;
  return (
    <Panel title="App name" description="Shown in your dashboard. Renaming doesn't change your app's web address.">
      <form onSubmit={submit} style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        <label htmlFor={id} style={srOnly}>
          App name
        </label>
        <input
          id={id}
          value={name}
          maxLength={120}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
            setError(null);
          }}
          style={{ ...inputStyle, flex: "1 1 220px", width: "auto" }}
        />
        <Button type="submit" variant="primary" disabled={saving || unchanged}>
          {saving ? "Saving…" : "Rename"}
        </Button>
      </form>
      <Status error={error} ok={saved ? "Renamed." : null} />
    </Panel>
  );
}

// ------------------------------------------------------------------ sign-in

function SignInSection({ appId, summary, settings, onSaved }: { appId: string; summary: AppSummary | null; settings: Settings; onSaved: (s: Settings) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [fromName, setFromName] = useState(settings.auth.emailFromName ?? "");
  const [ownClientOpen, setOwnClientOpen] = useState(!settings.auth.usesPlexoGoogleClient);
  const [clientId, setClientId] = useState(settings.auth.googleClientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const seq = useRef(0);
  const { auth } = settings;

  const patch = async (key: string, body: Partial<Record<string, unknown>>, success: string) => {
    const mine = ++seq.current;
    setBusy(key);
    setError(null);
    setOk(null);
    try {
      const next = await api<Settings>(`/api/v1/apps/${appId}/settings`, { method: "PATCH", json: { auth: body } });
      if (mine !== seq.current) return true;
      onSaved(next);
      setOk(success);
      return true;
    } catch (err) {
      if (mine === seq.current) setError(errText(err, "Couldn't save that change."));
      return false;
    } finally {
      if (mine === seq.current) setBusy(null);
    }
  };

  const toggle = (key: AuthToggle, value: boolean) => {
    const methods = { password: auth.password, magicLink: auth.magicLink, google: auth.google, [key]: value };
    if (!methods.password && !methods.magicLink && !methods.google) {
      setError("Keep at least one way to sign in turned on, or your users won't be able to log in.");
      return;
    }
    void patch(key, { [key]: value }, "Saved.");
  };

  const origins = [...(summary?.domains ?? []).map((d) => `https://${d.domain}`), ...(summary?.previewUrl ? [summary.previewUrl] : [])];
  const redirectUris = Array.from(new Set(origins)).map((o) => `${o.replace(/\/$/, "")}/__plexo/api/auth/oauth/google/callback`);

  const saveOwnClient = async (e: FormEvent) => {
    e.preventDefault();
    if (!/\.apps\.googleusercontent\.com$/.test(clientId.trim())) return setError("That doesn't look like a Google OAuth client ID — it ends in .apps.googleusercontent.com.");
    if (!clientSecret.trim()) return setError("Add the client secret too.");
    if (await patch("googleClient", { googleClientId: clientId.trim(), googleClientSecret: clientSecret.trim() }, "Your Google client is saved. Sign-in with Google now shows your app's name.")) setClientSecret("");
  };

  const removeOwnClient = async () => {
    if (!window.confirm("Go back to Plexo's Google sign-in? Your own client ID and secret will be removed.")) return;
    if (await patch("googleClient", { googleClientId: null }, "Back on Plexo's Google sign-in.")) {
      setClientId("");
      setClientSecret("");
      setOwnClientOpen(false);
    }
  };

  return (
    <Panel title="Sign-in" description="How people create accounts and log in to your app. Changes apply right away to both Preview and Live.">
      <div style={{ display: "flex", flexDirection: "column" }}>
        <Toggle label="Email and password" hint="People sign up with their email and a password." checked={auth.password} busy={busy === "password"} onChange={(v) => toggle("password", v)} />
        <Toggle label="Magic link" hint="People get a one-click sign-in link by email — no password to remember." checked={auth.magicLink} busy={busy === "magicLink"} onChange={(v) => toggle("magicLink", v)} />
        <Toggle
          label="Google"
          hint={auth.usesPlexoGoogleClient ? "Works out of the box with Plexo's Google sign-in — nothing to set up." : "Uses your own Google client."}
          checked={auth.google}
          busy={busy === "google"}
          onChange={(v) => toggle("google", v)}
        />
        <Toggle
          label="Require email confirmation"
          hint="New accounts must click a link in their email before they can sign in."
          checked={auth.requireEmailConfirmation}
          busy={busy === "requireEmailConfirmation"}
          onChange={(v) => toggle("requireEmailConfirmation", v)}
        />
        <Toggle label="Allow new sign-ups" hint="Turn off to stop new accounts — people who already have one can still sign in." checked={auth.allowSignups} busy={busy === "allowSignups"} onChange={(v) => toggle("allowSignups", v)} />
      </div>

      {auth.google && (
        <details
          open={ownClientOpen}
          onToggle={(e) => setOwnClientOpen((e.currentTarget as HTMLDetailsElement).open)}
          style={{ marginTop: "0.8rem", border: `1px solid ${C.border}`, borderRadius: 10, padding: "0.6rem 0.8rem" }}
        >
          <summary style={{ cursor: "pointer", fontSize: "0.78rem", fontWeight: 600, color: C.text }}>
            Use your own Google client {auth.usesPlexoGoogleClient ? "(optional)" : "— in use"}
          </summary>
          <div style={{ marginTop: "0.6rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            <p style={{ margin: 0, fontSize: "0.74rem", color: C.muted, lineHeight: 1.5 }}>
              Optional. With your own client, Google&apos;s sign-in screen shows your app&apos;s name and logo instead of Plexo&apos;s. Create an OAuth client (type “Web application”) in the Google Cloud console and add
              {redirectUris.length === 1 ? " this redirect URI" : " these redirect URIs"}:
            </p>
            {redirectUris.length ? (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                {redirectUris.map((u) => (
                  <li key={u}>
                    <CopyRow value={u} />
                  </li>
                ))}
              </ul>
            ) : (
              <Notice tone="warning">Build your app once to get its address, then come back for the redirect URI.</Notice>
            )}
            <form onSubmit={saveOwnClient} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <label style={fieldStyle}>
                <span style={labelStyle}>Client ID</span>
                <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="1234-abc.apps.googleusercontent.com" autoComplete="off" spellCheck={false} style={{ ...inputStyle, fontFamily: C.mono }} />
              </label>
              <label style={fieldStyle}>
                <span style={labelStyle}>Client secret</span>
                <input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder={auth.hasGoogleClientSecret ? "Saved — enter a new one to replace it" : "GOCSPX-…"}
                  autoComplete="new-password"
                  spellCheck={false}
                  style={{ ...inputStyle, fontFamily: C.mono }}
                />
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                <Button type="submit" variant="primary" disabled={busy === "googleClient"}>
                  {busy === "googleClient" ? "Saving…" : "Save Google client"}
                </Button>
                {!auth.usesPlexoGoogleClient && (
                  <Button variant="ghost" onClick={() => void removeOwnClient()} disabled={busy === "googleClient"}>
                    Remove — use Plexo&apos;s
                  </Button>
                )}
              </div>
            </form>
          </div>
        </details>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void patch("fromName", { emailFromName: fromName.trim() }, "Sender name saved.");
        }}
        style={{ marginTop: "0.9rem", display: "flex", flexDirection: "column", gap: 4 }}
      >
        <label htmlFor={`${appId}-from-name`} style={labelStyle}>
          Email sender name
        </label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          <input
            id={`${appId}-from-name`}
            value={fromName}
            maxLength={80}
            onChange={(e) => setFromName(e.target.value)}
            placeholder={summary?.name ?? "Your app's name"}
            style={{ ...inputStyle, flex: "1 1 220px", width: "auto" }}
          />
          <Button type="submit" disabled={busy === "fromName" || fromName.trim() === (auth.emailFromName ?? "")}>
            {busy === "fromName" ? "Saving…" : "Save"}
          </Button>
        </div>
        <span style={{ fontSize: "0.7rem", color: C.faint }}>The “from” name on sign-in and confirmation emails. Leave empty to use your app&apos;s name.</span>
      </form>

      <Status error={error} ok={ok} />
    </Panel>
  );
}

function Toggle({ label, hint, checked, busy, onChange }: { label: string; hint: string; checked: boolean; busy: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", padding: "0.55rem 0", borderTop: `1px solid ${C.border}` }}>
      <div style={{ minWidth: 0 }}>
        <label htmlFor={id} style={{ fontSize: "0.8rem", fontWeight: 600, color: C.text, cursor: "pointer" }}>
          {label}
        </label>
        <p id={`${id}-hint`} style={{ margin: "2px 0 0", fontSize: "0.72rem", color: C.muted, lineHeight: 1.45 }}>
          {hint}
        </p>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={`${id}-hint`}
        aria-busy={busy}
        disabled={busy}
        onClick={() => onChange(!checked)}
        style={{
          flexShrink: 0,
          width: 38,
          height: 22,
          borderRadius: 99,
          border: "none",
          padding: 2,
          cursor: busy ? "wait" : "pointer",
          background: checked ? C.brand : "rgba(255,255,255,0.15)",
          opacity: busy ? 0.6 : 1,
          transition: "background 0.15s",
        }}
      >
        <span style={{ display: "block", width: 18, height: 18, borderRadius: 99, background: "#fff", transform: checked ? "translateX(16px)" : "none", transition: "transform 0.15s" }} />
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ storage

function BucketsSection({ appId, settings, onSaved }: { appId: string; settings: Settings; onSaved: (s: Settings) => void }) {
  const [drafts, setDrafts] = useState<BucketDraft[]>(() => toDrafts(settings.buckets));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const nextKey = useRef(0);

  const update = (key: string, change: Partial<BucketDraft>) => {
    setOk(null);
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...change } : d)));
  };

  const problemOf = (d: BucketDraft, all: BucketDraft[]): string | null => {
    if (!d.name) return "Name it";
    if (!BUCKET_RE.test(d.name)) return "Lowercase letters, numbers and hyphens (2–63)";
    if (all.filter((x) => x.name === d.name).length > 1) return "Already used";
    if (d.maxMb && !(Number(d.maxMb) > 0 && Number(d.maxMb) <= 200)) return "Between 1 and 200 MB";
    return null;
  };
  const problems = drafts.map((d) => problemOf(d, drafts));
  const dirty = JSON.stringify(drafts.map(({ key: _k, ...rest }) => rest)) !== JSON.stringify(toDrafts(settings.buckets).map(({ key: _k, ...rest }) => rest));

  const save = async () => {
    if (problems.some(Boolean)) return setError("Fix the highlighted buckets first.");
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const buckets = Object.fromEntries(drafts.map((d) => [d.name, { access: d.access, ...(d.maxMb ? { maxBytes: Math.round(Number(d.maxMb) * MB) } : {}) }]));
      const next = await api<Settings>(`/api/v1/apps/${appId}/settings`, { method: "PATCH", json: { buckets } });
      onSaved(next);
      setDrafts(toDrafts(next.buckets));
      setOk("Storage saved.");
    } catch (err) {
      setError(errText(err, "Couldn't save storage settings."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel
      title="File storage"
      description={
        <>
          Folders (“buckets”) where your app keeps uploaded files. Any bucket your code uses works without setting it up here: <b style={{ color: C.text }}>avatars</b>, <b style={{ color: C.text }}>images</b>,{" "}
          <b style={{ color: C.text }}>media</b> and names starting with <b style={{ color: C.text }}>public-</b> are public (anyone with the link can view); everything else is private. Signed-in visitors upload into their own folder. Add a bucket here to
          change its access or cap file sizes.
        </>
      }
    >
      {drafts.length === 0 ? (
        <p style={{ margin: "0 0 0.7rem", fontSize: "0.76rem", color: C.faint }}>Using the defaults above.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "0.7rem" }}>
          {drafts.map((d, i) => (
            <div key={d.key} style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem", alignItems: "flex-start" }}>
              <label style={{ ...fieldStyle, flex: "2 1 160px" }}>
                <span style={srOnly}>Bucket name</span>
                <input
                  value={d.name}
                  onChange={(e) => {
                    const name = e.target.value.toLowerCase().replace(/[\s_]+/g, "-");
                    // A fresh row follows the naming default until the owner picks access themselves.
                    update(d.key, d.key.startsWith("new-") && !d.name ? { name, access: defaultAccess(name) } : { name });
                  }}
                  placeholder="bucket-name"
                  aria-invalid={!!problems[i]}
                  style={{ ...inputStyle, fontFamily: C.mono, borderColor: problems[i] ? "rgba(248,113,113,0.5)" : C.border }}
                />
                {problems[i] && <span style={{ fontSize: "0.68rem", color: C.danger }}>{problems[i]}</span>}
              </label>
              <label style={{ ...fieldStyle, flex: "1 1 110px" }}>
                <span style={srOnly}>Access</span>
                <select value={d.access} onChange={(e) => update(d.key, { access: e.target.value as Access })} style={inputStyle}>
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                </select>
              </label>
              <label style={{ ...fieldStyle, flex: "1 1 120px", flexDirection: "row", alignItems: "center", gap: 6 }}>
                <input
                  value={d.maxMb}
                  onChange={(e) => update(d.key, { maxMb: e.target.value.replace(/[^\d.]/g, "") })}
                  inputMode="decimal"
                  placeholder="No limit"
                  aria-label="Largest file, in MB"
                  style={{ ...inputStyle, width: "100%" }}
                />
                <span style={{ fontSize: "0.72rem", color: C.muted }}>MB max</span>
              </label>
              <Button variant="ghost" size="sm" onClick={() => setDrafts((prev) => prev.filter((x) => x.key !== d.key))} aria-label={`Remove bucket ${d.name || "row"}`} style={{ marginTop: 4 }}>
                <Trash2 size={13} aria-hidden />
              </Button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        <Button
          size="sm"
          onClick={() => {
            setOk(null);
            setDrafts((prev) => [...prev, { key: `new-${nextKey.current++}`, name: "", access: "private", maxMb: "" }]);
          }}
        >
          <Plus size={13} aria-hidden /> Add bucket
        </Button>
        {dirty && (
          <Button size="sm" variant="primary" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save storage"}
          </Button>
        )}
      </div>
      <Status error={error} ok={ok} />
    </Panel>
  );
}

// ------------------------------------------------------------------ domains

function DomainsSection({ summary }: { summary: AppSummary | null }) {
  const domains = summary?.domains ?? [];
  return (
    <Panel title="Web addresses" description={summary?.published ? "Where visitors find your live app." : "Your app gets a free address the first time you publish."}>
      {domains.length > 0 && (
        <ul style={{ listStyle: "none", margin: "0 0 0.7rem", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {domains.map((d) => (
            <li key={d.domain} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.4rem 0.7rem", fontSize: "0.8rem" }}>
              <Globe size={14} color={C.muted} aria-hidden />
              <a href={`https://${d.domain}`} target="_blank" rel="noreferrer" style={{ color: C.text, fontFamily: C.mono, overflowWrap: "anywhere" }}>
                {d.domain}
              </a>
              {!d.verified && <span style={{ fontSize: "0.7rem", color: C.warning }}>Waiting for DNS — finish setup in Domains</span>}
            </li>
          ))}
        </ul>
      )}
      {summary?.previewUrl && (
        <p style={{ margin: "0 0 0.7rem", fontSize: "0.74rem", color: C.muted }}>
          Private preview:{" "}
          <a href={summary.previewUrl} target="_blank" rel="noreferrer" style={{ color: C.muted, fontFamily: C.mono, overflowWrap: "anywhere" }}>
            {summary.previewUrl.replace(/^https:\/\//, "")}
          </a>
        </p>
      )}
      <Link href="/dashboard/domains" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "0.78rem", fontWeight: 600, color: "#c4b5fd" }}>
        Connect your own domain <ExternalLink size={12} aria-hidden />
      </Link>
    </Panel>
  );
}

// ------------------------------------------------------------------ danger zone

function DangerZone({ appId, summary }: { appId: string; summary: AppSummary | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const name = summary?.name ?? "";

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const remove = async (e: FormEvent) => {
    e.preventDefault();
    if (typed.trim() !== name) return;
    setDeleting(true);
    setError(null);
    try {
      await api(`/api/v1/apps/${appId}`, { method: "DELETE" });
      router.push("/dashboard/apps");
    } catch (err) {
      setError(errText(err, "Couldn't delete the app."));
      setDeleting(false);
    }
  };

  return (
    <Panel title="Danger zone" style={{ borderColor: "rgba(248,113,113,0.25)" }}>
      {!open ? (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.7rem" }}>
          <p style={{ margin: 0, fontSize: "0.76rem", color: C.muted, flex: "1 1 260px" }}>Delete this app, its code, database, files, users and web addresses. This can&apos;t be undone.</p>
          <Button variant="danger" onClick={() => setOpen(true)} disabled={!summary}>
            Delete app
          </Button>
        </div>
      ) : (
        <form onSubmit={remove} style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          <Notice tone="danger">
            This permanently deletes <b>{name}</b> — the live app goes offline and all its data (database, uploaded files, user accounts) is gone for good.
          </Notice>
          <label style={fieldStyle}>
            <span style={labelStyle}>
              Type <b style={{ color: C.text }}>{name}</b> to confirm
            </span>
            <input ref={inputRef} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} style={inputStyle} />
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            <Button type="submit" variant="danger" disabled={deleting || typed.trim() !== name}>
              {deleting ? "Deleting…" : "Delete forever"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
                setTyped("");
                setError(null);
              }}
              disabled={deleting}
            >
              Cancel
            </Button>
          </div>
          <Status error={error} ok={null} />
        </form>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------ bits

function Status({ error, ok }: { error: string | null; ok: string | null }): ReactNode {
  if (!error && !ok) return null;
  return (
    <div role={error ? "alert" : "status"} style={{ marginTop: "0.7rem" }}>
      <Notice tone={error ? "danger" : "success"}>{error ?? ok}</Notice>
    </div>
  );
}

function CopyRow({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(0,0,0,0.3)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "0.35rem 0.5rem" }}>
      <code style={{ flex: 1, minWidth: 0, fontFamily: C.mono, fontSize: "0.72rem", color: C.text, overflowWrap: "anywhere" }}>{value}</code>
      <button
        type="button"
        aria-label="Copy redirect URI"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        style={{ background: "none", border: "none", color: copied ? C.success : C.muted, cursor: "pointer", display: "flex", padding: 2 }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

const fieldStyle = { display: "flex", flexDirection: "column" as const, gap: 4, minWidth: 0 };
const labelStyle = { fontSize: "0.72rem", fontWeight: 600, color: C.muted };
const srOnly = { position: "absolute" as const, width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap" as const, border: 0 };
const linkButton = { background: "none", border: "none", padding: 0, color: "inherit", textDecoration: "underline", cursor: "pointer", font: "inherit" };
