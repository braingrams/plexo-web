"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink, FolderOpen, Globe, Image as ImageIcon, KeyRound, Link2, Mail, PenLine, Plus, Search, Settings2, ShieldCheck, Trash2, Upload, UserCheck } from "lucide-react";
import { api, appsApi, ApiError, type AppSummary } from "./api";
import { Button, C, Notice, Panel, Pill, ProblemState, Shimmer, StateStyles, hueGradient, inputStyle } from "./ui";

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
  seo: Partial<Record<"title" | "description" | "imageUrl" | "faviconUrl" | "googleVerification" | "bingVerification", string>>;
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

type SectionId = "general" | "seo" | "signin" | "files" | "delete";
const SECTIONS: { id: SectionId; label: string; icon: typeof Globe; hint: string }[] = [
  { id: "general", label: "General", icon: Settings2, hint: "Your app's name and where people find it." },
  { id: "seo", label: "Search & sharing", icon: Search, hint: "How your app shows up on Google and when someone shares a link to it." },
  { id: "signin", label: "Sign-in", icon: KeyRound, hint: "How people create accounts and log in to your app." },
  { id: "files", label: "Files", icon: FolderOpen, hint: "Files people upload to your app, and who can see them." },
  { id: "delete", label: "Delete app", icon: Trash2, hint: "Remove this app and everything in it." },
];

/** The app's identity at the top of Settings: its colour tile, name, address and whether it's live. */
function AppBanner({ summary }: { summary: AppSummary | null }) {
  if (!summary) return <Shimmer height={92} radius={20} />;
  const address = summary.domains.find((d) => d.verified)?.domain ?? summary.liveUrl?.replace(/^https:\/\//, "") ?? null;
  return (
    <section style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", padding: "1.2rem 1.4rem", borderRadius: 20, border: `1px solid ${C.border}`, background: "radial-gradient(60% 140% at 100% 0%, rgba(139,92,246,0.2), transparent 60%), radial-gradient(50% 120% at 0% 100%, rgba(99,102,241,0.12), transparent 60%), rgba(255,255,255,0.015)" }}>
      <span aria-hidden style={{ width: 56, height: 56, borderRadius: 16, flexShrink: 0, display: "grid", placeItems: "center", background: hueGradient(summary.name), color: "#fff", fontSize: "clamp(1.15rem, 4.2vw, 1.4rem)", fontWeight: 800, boxShadow: "0 10px 28px rgba(139,92,246,0.3)" }}>
        {summary.name.charAt(0).toUpperCase()}
      </span>
      <div style={{ flex: "1 1 240px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: "1.2rem", fontWeight: 750, color: C.text }}>{summary.name}</span>
          <Pill color={summary.published ? C.success : C.muted}>{summary.published ? "Live" : "Not published yet"}</Pill>
        </div>
        <div style={{ fontSize: "0.82rem", color: C.muted, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {address ? (
            <a href={`https://${address}`} target="_blank" rel="noreferrer" style={{ color: "#c4b5fd", textDecoration: "none" }}>
              {address} <ExternalLink size={11} aria-hidden style={{ verticalAlign: "-1px" }} />
            </a>
          ) : (
            "Publish your app to give it a web address."
          )}
        </div>
      </div>
    </section>
  );
}

function SettingsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading settings" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {[0, 1].map((i) => (
        <div key={i} style={{ display: "flex", gap: 14, padding: "1.3rem 1.4rem", borderRadius: 18, border: `1px solid ${C.border}` }}>
          <Shimmer width={40} height={40} radius={12} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
            <Shimmer width="30%" height={13} />
            <Shimmer width="60%" height={9} />
            <Shimmer height={38} radius={10} style={{ marginTop: 6 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SettingsPane({ appId, summary, onRenamed }: { appId: string; summary: AppSummary | null; onRenamed?: (name: string) => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [section, setSection] = useState<SectionId>("general");

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

  const needsSettings = section === "seo" || section === "signin" || section === "files";
  const current = SECTIONS.find((s) => s.id === section)!;

  return (
    <div style={{ position: "absolute", inset: 0, overflowY: "auto", padding: "1.4rem 1.8rem 2.5rem" }}>
      <StateStyles />
      <AppBanner summary={summary} />
      <nav aria-label="App settings" className="dash-pill-nav" style={{ margin: "1.3rem 0 0.6rem", overflowX: "auto" }}>
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={id === section ? "page" : undefined}
            onClick={() => setSection(id)}
            className={`dash-pill-nav-item${id === section ? " active" : ""}`}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontFamily: "inherit", ...(id === section ? {} : { background: "transparent", border: "1px solid transparent" }), ...(id === "delete" ? { color: C.danger } : {}) }}
          >
            <Icon size={14} aria-hidden />
            {label}
          </button>
        ))}
      </nav>
      <p style={{ margin: "0 0 1rem", fontSize: "0.8rem", color: C.muted }}>{current.hint}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
          {section === "general" && (
            <>
              <NameSection appId={appId} summary={summary} onRenamed={onRenamed} />
              <DomainsSection summary={summary} />
            </>
          )}
          {needsSettings && loadError && !settings && <ProblemState title="We couldn't load these settings just now" message={`${loadError} Nothing has changed.`} onRetry={() => void load()} />}
          {needsSettings && !settings && !loadError && <SettingsSkeleton />}
          {settings && section === "seo" && <SeoSection key={appId} appId={appId} summary={summary} settings={settings} onSaved={setSettings} />}
          {settings && section === "signin" && <SignInSection appId={appId} summary={summary} settings={settings} onSaved={setSettings} />}
          {settings && section === "files" && <BucketsSection appId={appId} settings={settings} onSaved={setSettings} />}
          {section === "delete" && <DangerZone appId={appId} summary={summary} />}
        </div>
    </div>
  );
}

// ------------------------------------------------------------------ search & sharing

const SEO_FIELDS = ["title", "description", "imageUrl", "faviconUrl", "googleVerification", "bingVerification"] as const;
type SeoDraft = Record<(typeof SEO_FIELDS)[number], string>;
const seoDraft = (seo: Settings["seo"]): SeoDraft => Object.fromEntries(SEO_FIELDS.map((k) => [k, seo?.[k] ?? ""])) as SeoDraft;

function SeoSection({ appId, summary, settings, onSaved }: { appId: string; summary: AppSummary | null; settings: Settings; onSaved: (s: Settings) => void }) {
  const [draft, setDraft] = useState<SeoDraft>(() => seoDraft(settings.seo));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"imageUrl" | "faviconUrl" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const set = (k: keyof SeoDraft, v: string) => {
    setOk(null);
    setError(null);
    setDraft((d) => ({ ...d, [k]: v }));
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(seoDraft(settings.seo));

  const upload = async (field: "imageUrl" | "faviconUrl", file: File) => {
    setUploading(field);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/v1/media/upload", { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) throw new Error(data?.error ?? "That upload didn't work. Try a PNG or JPG under 5 MB.");
      set(field, new URL(data.url, window.location.origin).toString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "That upload didn't work.");
    } finally {
      setUploading(null);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const next = await api<Settings>(`/api/v1/apps/${appId}/settings`, { method: "PATCH", json: { seo: draft } });
      onSaved(next);
      setDraft(seoDraft(next.seo));
      setOk(summary?.published ? "Saved. Your live app shows the new details within a minute." : "Saved. They'll appear once you publish.");
    } catch (err) {
      setError(errText(err, "Couldn't save these settings."));
    } finally {
      setSaving(false);
    }
  };

  const address = summary?.domains?.[0]?.domain ?? summary?.previewUrl?.replace(/^https:\/\//, "") ?? "yourapp.plexo.site";
  const shownTitle = draft.title.trim() || summary?.name || "Your app";
  const shownDescription = draft.description.trim() || "Add a short description so people know what they'll find before they click.";

  return (
    <form onSubmit={save} className="seo-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(280px, 400px)", gap: "1.2rem", alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem", minWidth: 0 }}>
        <Panel icon={<Search size={18} />} title="How your app appears in search" description="What people see in Google results and when your link is shared in a chat or on social media.">
          <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
            <TextField label="Title" value={draft.title} max={70} placeholder={summary?.name ?? "Acme — handmade candles"} onChange={(v) => set("title", v)} />
            <TextField label="Description" value={draft.description} max={200} multiline placeholder="One or two sentences about what your app does and who it's for." onChange={(v) => set("description", v)} />
          </div>
        </Panel>
        <Panel icon={<ImageIcon size={18} />} iconColor="#c084fc" title="Images">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.9rem" }}>
            <ImageField label="Sharing image" hint="Shown on link previews. 1200 × 630 works best." value={draft.imageUrl} busy={uploading === "imageUrl"} wide onUpload={(f) => void upload("imageUrl", f)} onClear={() => set("imageUrl", "")} />
            <ImageField label="Browser-tab icon" hint="A square image, at least 64 × 64." value={draft.faviconUrl} busy={uploading === "faviconUrl"} onUpload={(f) => void upload("faviconUrl", f)} onClear={() => set("faviconUrl", "")} />
          </div>
        </Panel>
        <Panel
          icon={<ShieldCheck size={18} />}
          iconColor="#6366f1"
          title="Prove you own this app"
          description="Google Search Console and Bing Webmaster Tools ask for this before showing your search traffic. Choose the “HTML tag” option there and paste the code — or the whole tag — here."
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "0.8rem" }}>
            <TextField label="Google verification code" value={draft.googleVerification} placeholder="Paste from Search Console" mono onChange={(v) => set("googleVerification", v)} />
            <TextField label="Bing verification code" value={draft.bingVerification} placeholder="Paste from Webmaster Tools" mono onChange={(v) => set("bingVerification", v)} />
          </div>
        </Panel>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
          <Button type="submit" variant="primary" disabled={saving || !dirty || !!uploading}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
          {dirty && !saving && (
            <Button variant="ghost" onClick={() => setDraft(seoDraft(settings.seo))}>
              Discard
            </Button>
          )}
        </div>
        <Status error={error} ok={ok} />
      </div>

      <aside style={{ display: "flex", flexDirection: "column", gap: "0.9rem", position: "sticky", top: 0 }}>
        <div style={previewLabel}>In Google</div>
        <div style={{ background: "#fff", borderRadius: 12, padding: "0.9rem 1rem", color: "#202124", fontFamily: "Arial, sans-serif" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 26, height: 26, borderRadius: 99, background: "#f1f3f4", display: "grid", placeItems: "center", overflow: "hidden", flexShrink: 0 }}>
              {draft.faviconUrl ? <img src={draft.faviconUrl} alt="" width={18} height={18} style={{ objectFit: "contain" }} /> : <Globe size={14} color="#5f6368" />}
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 13, color: "#202124" }}>{shownTitle.split(/[—|-]/)[0].trim()}</span>
              <span style={{ display: "block", fontSize: 12, color: "#4d5156", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>https://{address}</span>
            </span>
          </div>
          <div style={{ marginTop: 6, fontSize: 18, lineHeight: 1.3, color: "#1a0dab", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shownTitle}</div>
          <div style={{ marginTop: 3, fontSize: 13, lineHeight: 1.5, color: draft.description.trim() ? "#4d5156" : "#9aa0a6", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{shownDescription}</div>
        </div>
        <div style={previewLabel}>When shared</div>
        <div style={{ borderRadius: 12, overflow: "hidden", border: `1px solid ${C.borderStrong}`, background: C.panelSolid }}>
          <div style={{ aspectRatio: "1200 / 630", background: draft.imageUrl ? `center / cover no-repeat url("${draft.imageUrl}")` : "linear-gradient(135deg, rgba(139,92,246,0.35), rgba(124,58,237,0.1))", display: "grid", placeItems: "center" }}>
            {!draft.imageUrl && <ImageIcon size={28} color="rgba(255,255,255,0.5)" />}
          </div>
          <div style={{ padding: "0.65rem 0.8rem" }}>
            <div style={{ fontSize: "0.68rem", color: C.faint, textTransform: "uppercase", letterSpacing: "0.04em" }}>{address}</div>
            <div style={{ fontSize: "0.84rem", fontWeight: 700, color: C.text, marginTop: 2 }}>{shownTitle}</div>
            <div style={{ fontSize: "0.74rem", color: C.muted, marginTop: 2, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{shownDescription}</div>
          </div>
        </div>
      </aside>
      <style>{`@media (max-width: 1100px) { .seo-grid { grid-template-columns: minmax(0, 1fr) !important; } }`}</style>
    </form>
  );
}

function TextField({ label, value, onChange, placeholder, max, multiline, mono }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; max?: number; multiline?: boolean; mono?: boolean }) {
  const id = useId();
  const over = max !== undefined && value.length > max;
  const style = { ...inputStyle, fontFamily: mono ? C.mono : undefined, borderColor: over ? "rgba(248,113,113,0.5)" : C.border, resize: "vertical" as const };
  return (
    <div style={fieldStyle}>
      <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <label htmlFor={id} style={labelStyle}>
          {label}
        </label>
        {max !== undefined && <span style={{ fontSize: "0.7rem", color: over ? C.danger : C.faint }}>{value.length}/{max}</span>}
      </span>
      {multiline ? (
        <textarea id={id} value={value} rows={3} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={style} />
      ) : (
        <input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} spellCheck={!mono} autoComplete="off" style={style} />
      )}
    </div>
  );
}

function ImageField({ label, hint, value, busy, wide, onUpload, onClear }: { label: string; hint: string; value: string; busy: boolean; wide?: boolean; onUpload: (f: File) => void; onClear: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <button
        type="button"
        onClick={() => input.current?.click()}
        aria-label={`Upload ${label.toLowerCase()}`}
        style={{
          width: wide ? 120 : 64,
          height: 64,
          flexShrink: 0,
          borderRadius: 10,
          border: `1px dashed ${value ? "transparent" : C.borderStrong}`,
          background: value ? `center / ${wide ? "cover" : "contain"} no-repeat url("${value}"), rgba(255,255,255,0.04)` : "rgba(255,255,255,0.03)",
          display: "grid",
          placeItems: "center",
          cursor: "pointer",
          color: C.muted,
        }}
      >
        {!value && <Upload size={16} aria-hidden />}
      </button>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "0.8rem", fontWeight: 600, color: C.text }}>{label}</div>
        <div style={{ fontSize: "0.72rem", color: C.muted, lineHeight: 1.45 }}>{hint}</div>
        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <button type="button" onClick={() => input.current?.click()} disabled={busy} style={{ ...linkButton, color: "#c4b5fd", textDecoration: "none", fontSize: "0.74rem", fontWeight: 600 }}>
            {busy ? "Uploading…" : value ? "Replace" : "Upload"}
          </button>
          {value && !busy && (
            <button type="button" onClick={onClear} style={{ ...linkButton, color: C.muted, textDecoration: "none", fontSize: "0.74rem" }}>
              Remove
            </button>
          )}
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onUpload(file);
        }}
      />
    </div>
  );
}

const previewLabel = { fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" as const, color: C.faint, marginBottom: -6 };

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
    <Panel icon={<PenLine size={18} />} title="App name" description="Shown in your dashboard. Renaming doesn't change your app's web address.">
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
    <>
    <Panel icon={<KeyRound size={18} />} title="Ways to sign in" description="Pick how people create accounts and log in. Changes apply right away to both Preview and Live.">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
        <MethodTile icon={<Mail size={20} />} label="Email and password" hint="They pick a password when they sign up." checked={auth.password} busy={busy === "password"} onChange={(v) => toggle("password", v)} />
        <MethodTile icon={<Link2 size={20} />} label="Magic link" hint="A one-click sign-in link by email. Nothing to remember." checked={auth.magicLink} busy={busy === "magicLink"} onChange={(v) => toggle("magicLink", v)} />
        <MethodTile
          icon={<GoogleMark />}
          label="Google"
          hint={auth.usesPlexoGoogleClient ? "Works straight away — nothing to set up." : "Uses your own Google sign-in."}
          checked={auth.google}
          busy={busy === "google"}
          onChange={(v) => toggle("google", v)}
        />
      </div>
    </Panel>
    <Panel icon={<UserCheck size={18} />} iconColor="#6366f1" title="Who can join">
      <div style={{ display: "flex", flexDirection: "column" }}>
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
    </>
  );
}

/** One way to sign in, as a picture tile that switches on and off. */
function MethodTile({ icon, label, hint, checked, busy, onChange }: { icon: ReactNode; label: string; hint: string; checked: boolean; busy: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-busy={busy}
      disabled={busy}
      onClick={() => onChange(!checked)}
      className="plx-lift"
      style={{
        textAlign: "left",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "1rem",
        borderRadius: 16,
        cursor: busy ? "wait" : "pointer",
        fontFamily: "inherit",
        color: C.text,
        border: `1px solid ${checked ? "rgba(139,92,246,0.55)" : C.border}`,
        background: checked ? "linear-gradient(135deg, rgba(139,92,246,0.16), rgba(99,102,241,0.05))" : "rgba(255,255,255,0.02)",
        opacity: busy ? 0.7 : 1,
      }}
    >
      <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ width: 40, height: 40, borderRadius: 12, display: "grid", placeItems: "center", background: checked ? "rgba(139,92,246,0.25)" : "rgba(255,255,255,0.06)", color: checked ? "#c4b5fd" : C.muted }}>{icon}</span>
        <span aria-hidden style={{ width: 34, height: 20, borderRadius: 99, padding: 2, background: checked ? C.brand : "rgba(255,255,255,0.15)", transition: "background 0.15s" }}>
          <span style={{ display: "block", width: 16, height: 16, borderRadius: 99, background: "#fff", transform: checked ? "translateX(14px)" : "none", transition: "transform 0.15s" }} />
        </span>
      </span>
      <span>
        <span style={{ display: "block", fontSize: "0.88rem", fontWeight: 700 }}>{label}</span>
        <span style={{ display: "block", fontSize: "0.75rem", color: C.muted, lineHeight: 1.45, marginTop: 3 }}>{hint}</span>
      </span>
    </button>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.81.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.98v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.98A9 9 0 0 0 0 9c0 1.45.35 2.83.98 4.03l2.97-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .98 4.97l2.97 2.33C4.66 5.17 6.65 3.58 9 3.58z" />
    </svg>
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
    if (problems.some(Boolean)) return setError("Fix the highlighted folders first.");
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const buckets = Object.fromEntries(drafts.map((d) => [d.name, { access: d.access, ...(d.maxMb ? { maxBytes: Math.round(Number(d.maxMb) * MB) } : {}) }]));
      const next = await api<Settings>(`/api/v1/apps/${appId}/settings`, { method: "PATCH", json: { buckets } });
      onSaved(next);
      setDrafts(toDrafts(next.buckets));
      setOk("Saved.");
    } catch (err) {
      setError(errText(err, "Couldn't save the folders."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel
      icon={<FolderOpen size={18} />}
      iconColor="#c084fc"
      title="Upload folders"
      description={
        <>
          Your app can save files people upload — photos, documents, profile pictures — without any setup. Folders named <b style={{ color: C.text }}>avatars</b>, <b style={{ color: C.text }}>images</b>, <b style={{ color: C.text }}>media</b> or
          starting with <b style={{ color: C.text }}>public-</b> can be seen by anyone with the link; everything else is private to the person who uploaded it. Add a folder here only to change who can see it or to cap file sizes.
        </>
      }
    >
      {drafts.length === 0 ? (
        <p style={{ margin: "0 0 0.7rem", fontSize: "0.76rem", color: C.faint }}>No changes — every folder follows the rule above.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "0.7rem" }}>
          {drafts.map((d, i) => (
            <div key={d.key} style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem", alignItems: "flex-start" }}>
              <label style={{ ...fieldStyle, flex: "2 1 160px" }}>
                <span style={srOnly}>Folder name</span>
                <input
                  value={d.name}
                  onChange={(e) => {
                    const name = e.target.value.toLowerCase().replace(/[\s_]+/g, "-");
                    // A fresh row follows the naming default until the owner picks access themselves.
                    update(d.key, d.key.startsWith("new-") && !d.name ? { name, access: defaultAccess(name) } : { name });
                  }}
                  placeholder="folder-name"
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
              <Button variant="ghost" size="sm" onClick={() => setDrafts((prev) => prev.filter((x) => x.key !== d.key))} aria-label={`Remove folder ${d.name || "row"}`} style={{ marginTop: 4 }}>
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
          <Plus size={13} aria-hidden /> Add folder
        </Button>
        {dirty && (
          <Button size="sm" variant="primary" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save folders"}
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
    <Panel icon={<Globe size={18} />} iconColor="#6366f1" title="Web addresses" description={summary?.published ? "Where visitors find your live app." : "Your app gets a free address the first time you publish."}>
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
    <Panel icon={<Trash2 size={18} />} iconColor={C.danger} title="Delete this app" style={{ borderColor: "rgba(248,113,113,0.25)", background: "rgba(248,113,113,0.03)" }}>
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
