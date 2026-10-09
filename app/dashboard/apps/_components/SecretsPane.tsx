"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode, type RefObject } from "react";
import { Clock, Eye, EyeOff, Globe, KeyRound, Lock, PenLine, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { api, ApiError } from "./api";
import { Button, C, EmptyHero, IconButton, Notice, PaneHeader, Pill, ProblemState, Shimmer, StatCard, StateStyles, hueGradient, inputStyle, timeAgo } from "./ui";

// Private keys the app's server code reads (a payment key, an email service key…). Values are
// write-only: once saved they're never sent back — only the last few characters, so the owner
// can tell two keys apart.

type Scope = "all" | "dev" | "live";
type Secret = { name: string; scope: Scope; hint: string | null; updatedAt: string };

const SCOPE_LABEL: Record<Scope, string> = { all: "All", dev: "Preview only", live: "Live only" };
const SCOPE_CHOICES: { value: Scope; label: string }[] = [
  { value: "all", label: "Preview and Live" },
  { value: "dev", label: "Preview only" },
  { value: "live", label: "Live only" },
];
const NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;

// Purple family only for decoration; green is reserved for "set / working".
const PREVIEW_COLOR = "#c4b5fd";
const LIVE_COLOR = "#c084fc";

function nameProblem(name: string): string | null {
  if (!name) return null;
  if (!/^[A-Z]/.test(name)) return "Start the name with a letter.";
  if (!NAME_RE.test(name)) return "Use capital letters, numbers and underscores only (64 at most) — like STRIPE_SECRET_KEY.";
  return null;
}

export function SecretsPane({ appId, addName }: { appId: string; addName?: string }) {
  const [secrets, setSecrets] = useState<Secret[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState(addName?.toUpperCase() ?? "");
  const [value, setValue] = useState("");
  const [showValue, setShowValue] = useState(false);
  const [scope, setScope] = useState<Scope>("all");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  // Once there are keys, the add form folds away behind "Add a key" — unless SOL sent the owner here.
  const [adding, setAdding] = useState(!!addName);
  const nameRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const res = await api<{ secrets: Secret[] }>(`/api/v1/apps/${appId}/secrets`);
      if (mine !== seq.current) return;
      setSecrets(res.secrets);
      setLoadError(null);
    } catch (err) {
      if (mine === seq.current) setLoadError(err instanceof ApiError ? err.message : "Couldn't load your keys.");
    }
  }, [appId]);

  useEffect(() => {
    void load();
    return () => void (seq.current += 1);
  }, [load]);

  // SOL links here with the key an app needs: prefill it and jump straight to the value.
  useEffect(() => {
    if (!addName) return;
    setName(addName.toUpperCase());
    setValue("");
    setFormError(null);
    setMessage(null);
    setAdding(true);
    requestAnimationFrame(() => valueRef.current?.focus());
  }, [addName]);

  const problem = nameProblem(name);
  const replacing = !!secrets?.some((s) => s.name === name && s.scope === scope);
  const solAsked = !!addName && name === addName.toUpperCase();

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (!name) return setFormError("Give the key a name, like STRIPE_SECRET_KEY.");
    if (problem) return setFormError(problem);
    if (!value) return setFormError("Paste the key's value.");
    setSaving(true);
    setFormError(null);
    try {
      await api(`/api/v1/apps/${appId}/secrets`, { method: "PUT", json: { name, value, scope } });
      setMessage(`${replacing ? "Replaced" : "Saved"} ${name}. Your app will start using it within a few minutes — no need to rebuild.`);
      setName("");
      setValue("");
      setShowValue(false);
      setScope("all");
      await load();
      nameRef.current?.focus();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Couldn't save the key.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (s: Secret) => {
    const where = s.scope === "all" ? "" : ` (${SCOPE_LABEL[s.scope]})`;
    if (!window.confirm(`Delete ${s.name}${where}? Parts of your app that use it will stop working until you add it again.`)) return;
    const key = `${s.name}:${s.scope}`;
    setDeleting(key);
    setMessage(null);
    try {
      await api(`/api/v1/apps/${appId}/secrets`, { method: "DELETE", json: { name: s.name, scope: s.scope } });
      setSecrets((prev) => prev?.filter((x) => !(x.name === s.name && x.scope === s.scope)) ?? prev);
      setMessage(`Deleted ${s.name}.`);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Couldn't delete the key.");
    } finally {
      setDeleting(null);
    }
  };

  const startReplace = (s: Secret) => {
    setName(s.name);
    setScope(s.scope);
    setValue("");
    setFormError(null);
    setMessage(null);
    setAdding(true);
    // The form may only just be mounting — focus once it's there.
    requestAnimationFrame(() => valueRef.current?.focus());
  };

  const closeForm = () => {
    setAdding(false);
    setName("");
    setValue("");
    setShowValue(false);
    setScope("all");
    setFormError(null);
  };

  const form = (
    <KeyForm
      name={name}
      value={value}
      scope={scope}
      showValue={showValue}
      saving={saving}
      problem={problem}
      replacing={replacing}
      formError={formError}
      solAsked={solAsked}
      nameRef={nameRef}
      valueRef={valueRef}
      onName={(v) => {
        setName(v.toUpperCase().replace(/[\s-]+/g, "_"));
        setFormError(null);
      }}
      onValue={(v) => {
        setValue(v);
        setFormError(null);
      }}
      onScope={setScope}
      onToggleShow={() => setShowValue((v) => !v)}
      onSubmit={save}
    />
  );

  const hasKeys = !!secrets && secrets.length > 0;
  const liveCount = secrets?.filter((s) => s.scope !== "dev").length ?? 0;
  const lastChanged = secrets?.reduce<string | null>((latest, s) => (!latest || Date.parse(s.updatedAt) > Date.parse(latest) ? s.updatedAt : latest), null) ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <StateStyles />
      <PaneHeader
        title="Secret keys"
        subtitle="Private keys your app needs, like a payment or email service key. Once saved, a key is never shown again — not even to you."
        actions={
          hasKeys && !adding ? (
            <Button variant="primary" size="sm" onClick={() => {
              setAdding(true);
              setMessage(null);
              requestAnimationFrame(() => nameRef.current?.focus());
            }}>
              <Plus size={14} /> Add a key
            </Button>
          ) : undefined
        }
      />
      {message && (
        <div role="status">
          <Notice tone="success">{message}</Notice>
        </div>
      )}
      {loadError && secrets !== null && <Notice tone="danger">{loadError}</Notice>}

      {secrets === null ? (
        loadError ? (
          <ProblemState
            title="We couldn't load your keys just now"
            message={<>{loadError} Your saved keys are safe — nothing has been lost.</>}
            onRetry={() => {
              setLoadError(null);
              void load();
            }}
          />
        ) : (
          <KeysSkeleton />
        )
      ) : secrets.length === 0 ? (
        <EmptyHero
          tint="#8b5cf6"
          title="Keep your app's private keys here"
          body="Private keys your app needs, like a payment or email service key. They're stored encrypted, only your app's server code can read them, and they never appear in your app's pages. SOL will ask you when your app needs one."
          art={<VaultIllustration />}
        >
          <div style={{ padding: "1.1rem 1.2rem", borderRadius: 16, border: `1px solid ${C.borderStrong}`, background: "rgba(11,15,25,0.55)" }}>{form}</div>
        </EmptyHero>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <StatCard label={secrets.length === 1 ? "Key saved" : "Keys saved"} value={secrets.length} color="#8b5cf6" icon={KeyRound} />
            <StatCard label="Ready for your live app" value={liveCount} color="#6366f1" icon={Globe} />
            <StatCard label="Last changed" value={timeAgo(lastChanged)} color="#c084fc" icon={Clock} />
          </div>

          {adding && (
            <section style={{ padding: "1.2rem 1.3rem", borderRadius: 18, border: "1px solid rgba(139,92,246,0.35)", background: "radial-gradient(60% 120% at 100% 0%, rgba(139,92,246,0.14), transparent 60%), rgba(139,92,246,0.05)", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center", background: "rgba(139,92,246,0.22)", color: "#c4b5fd" }}>
                  <KeyRound size={17} />
                </span>
                <span style={{ flex: 1, fontSize: "0.95rem", fontWeight: 700 }}>{replacing ? "Replace a key" : "Add a key"}</span>
                <IconButton label="Close" onClick={closeForm}>
                  <X size={15} />
                </IconButton>
              </div>
              {form}
            </section>
          )}

          <section style={{ border: `1px solid ${C.border}`, borderRadius: 18, background: C.panel, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0.75rem 1rem", borderBottom: `1px solid ${C.border}`, fontSize: "0.76rem", color: C.muted }}>
              <ShieldCheck size={15} color={C.success} aria-hidden />
              Stored encrypted. Only your app&rsquo;s server code can read these — they never appear in your app&rsquo;s pages.
            </div>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {secrets.map((s, i) => {
                const key = `${s.name}:${s.scope}`;
                return (
                  <li key={key} className="plx-row" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.6rem 14px", padding: "0.8rem 1rem", borderTop: i ? `1px solid ${C.border}` : "none", opacity: deleting === key ? 0.55 : 1 }}>
                    <span aria-hidden style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0, display: "grid", placeItems: "center", background: hueGradient(s.name), color: "#fff", boxShadow: "0 6px 18px rgba(0,0,0,0.25)" }}>
                      <KeyRound size={18} />
                    </span>
                    <span style={{ flex: "1 1 240px", minWidth: 0, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 5 }}>
                      <span style={{ maxWidth: "100%", fontFamily: C.mono, fontSize: "0.8rem", fontWeight: 650, color: C.text, padding: "2px 8px", borderRadius: 7, background: "rgba(255,255,255,0.05)", border: `1px solid ${C.border}`, overflowWrap: "anywhere" }}>{s.name}</span>
                      <span style={{ fontSize: "0.74rem", color: C.muted, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontFamily: C.mono, letterSpacing: "0.08em", color: C.faint }} title={s.hint ? "The last few characters, so you can tell keys apart" : "Hidden for your safety"}>
                          ••••••••{s.hint ?? ""}
                        </span>
                        <span aria-hidden>·</span>
                        Updated {timeAgo(s.updatedAt)}
                      </span>
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {s.scope !== "live" && <Pill color={PREVIEW_COLOR}>Preview</Pill>}
                      {s.scope !== "dev" && <Pill color={LIVE_COLOR}>Live</Pill>}
                    </span>
                    <span style={{ display: "flex", gap: 4 }}>
                      <IconButton label={`Replace ${s.name}`} onClick={() => startReplace(s)}>
                        <PenLine size={15} />
                      </IconButton>
                      <IconButton label={`Delete ${s.name}`} danger disabled={deleting === key} onClick={() => void remove(s)}>
                        <Trash2 size={15} />
                      </IconButton>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

/** The add / replace form — sits in the empty hero, or in a panel above the list. */
function KeyForm(props: {
  name: string;
  value: string;
  scope: Scope;
  showValue: boolean;
  saving: boolean;
  problem: string | null;
  replacing: boolean;
  formError: string | null;
  solAsked: boolean;
  nameRef: RefObject<HTMLInputElement | null>;
  valueRef: RefObject<HTMLInputElement | null>;
  onName: (v: string) => void;
  onValue: (v: string) => void;
  onScope: (s: Scope) => void;
  onToggleShow: () => void;
  onSubmit: (e: FormEvent) => void;
}) {
  const { name, value, scope, showValue, saving, problem, replacing, formError, solAsked } = props;
  return (
    <form onSubmit={props.onSubmit} noValidate style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
      {solAsked && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0.6rem 0.8rem", borderRadius: 12, border: "1px solid rgba(139,92,246,0.45)", background: "rgba(139,92,246,0.12)", fontSize: "0.8rem", color: C.text }}>
          <span style={{ width: 26, height: 26, borderRadius: 8, flexShrink: 0, display: "grid", placeItems: "center", background: "linear-gradient(135deg, #8b5cf6, #6d28d9)", color: "#fff" }}>
            <KeyRound size={14} />
          </span>
          <span>
            <strong>SOL needs this key to finish your app.</strong> Paste it below and SOL can carry on.
          </span>
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.8rem" }}>
        <label style={fieldStyle}>
          <span style={labelStyle}>Key name</span>
          <input
            ref={props.nameRef}
            value={name}
            onChange={(e) => props.onName(e.target.value)}
            placeholder="STRIPE_SECRET_KEY"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!!problem}
            aria-describedby={problem ? "secret-name-problem" : undefined}
            style={{ ...inputStyle, fontFamily: C.mono, borderColor: problem ? "rgba(248,113,113,0.5)" : solAsked ? "rgba(139,92,246,0.55)" : C.border }}
          />
          {problem && (
            <span id="secret-name-problem" style={{ fontSize: "0.7rem", color: C.danger }}>
              {problem}
            </span>
          )}
        </label>
        <div style={{ ...fieldStyle, flex: "0 1 auto" }}>
          <span style={labelStyle} id="secret-scope-label">Used by</span>
          <ScopeChooser value={scope} onChange={props.onScope} />
        </div>
      </div>
      <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span style={labelStyle}>Value</span>
        <span style={{ position: "relative", display: "block" }}>
          <input
            ref={props.valueRef}
            type={showValue ? "text" : "password"}
            value={value}
            onChange={(e) => props.onValue(e.target.value)}
            placeholder="Paste the key here"
            autoComplete="new-password"
            spellCheck={false}
            style={{ ...inputStyle, fontFamily: C.mono, paddingRight: "2.4rem" }}
          />
          <button
            type="button"
            onClick={props.onToggleShow}
            aria-label={showValue ? "Hide what you typed" : "Show what you typed"}
            aria-pressed={showValue}
            style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: C.muted, cursor: "pointer", padding: 4, display: "flex" }}
          >
            {showValue ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </span>
      </label>
      {replacing && <Notice tone="warning">{name} already exists for {SCOPE_LABEL[scope] === "All" ? "Preview and Live" : SCOPE_LABEL[scope]} — saving replaces its value.</Notice>}
      {formError && <Notice tone="danger">{formError}</Notice>}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Button type="submit" variant="primary" disabled={saving}>
          <Lock size={14} aria-hidden /> {saving ? "Saving…" : replacing ? "Replace key" : "Save key"}
        </Button>
        <span style={{ fontSize: "0.74rem", color: C.faint }}>Encrypted as soon as you save. You won&rsquo;t see it again.</span>
      </div>
    </form>
  );
}

/** Where the key is used: one tap between both, Preview only and Live only. */
function ScopeChooser({ value, onChange }: { value: Scope; onChange: (s: Scope) => void }) {
  return (
    <div role="radiogroup" aria-labelledby="secret-scope-label" style={{ display: "inline-flex", flexWrap: "wrap", border: `1px solid ${C.border}`, borderRadius: 9, overflow: "hidden" }}>
      {SCOPE_CHOICES.map((c) => {
        const on = c.value === value;
        return (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(c.value)}
            style={{ padding: "0.5rem 0.75rem", fontSize: "0.76rem", fontWeight: 600, border: "none", cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit", background: on ? "rgba(139,92,246,0.28)" : "transparent", color: on ? C.text : C.muted }}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}

/** First load: stat cards and key rows, gently shimmering. */
function KeysSkeleton() {
  const widths = [38, 52, 30, 46];
  return (
    <div aria-busy="true" aria-label="Loading your keys" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "1rem 1.1rem", borderRadius: 16, border: `1px solid ${C.border}` }}>
            <Shimmer width={40} height={40} radius={12} />
            <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
              <Shimmer width={44} height={16} />
              <Shimmer width="60%" height={8} radius={99} />
            </span>
          </div>
        ))}
      </div>
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 18, padding: "0.3rem 1rem" }}>
        {widths.map((w, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "0.85rem 0", borderBottom: i < widths.length - 1 ? `1px solid ${C.border}` : "none" }}>
            <Shimmer width={40} height={40} radius={12} />
            <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
              <Shimmer width={`${w}%`} height={18} radius={7} />
              <Shimmer width="20%" height={8} radius={99} />
            </span>
            <Shimmer width={70} height={22} radius={99} />
            <Shimmer width={56} height={22} radius={99} />
            <Shimmer width={32} height={32} radius={9} />
            <Shimmer width={32} height={32} radius={9} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A friendly picture of a locked safe holding a few hidden keys. */
function VaultIllustration() {
  const rows = [
    { c: "#8b5cf6", w: "62%" },
    { c: "#c084fc", w: "48%" },
    { c: "#6366f1", w: "56%" },
  ];
  return (
    <div style={{ position: "relative", padding: "28px 8px 8px 28px" }}>
      <Tile style={{ position: "absolute", top: 0, left: 0, zIndex: 1 }}>
        <Lock size={28} />
      </Tile>
      <div style={{ borderRadius: 16, background: "rgba(11,15,25,0.6)", border: `1px solid ${C.borderStrong}`, padding: "28px 16px 16px", display: "flex", flexDirection: "column", gap: 12, boxShadow: "0 24px 60px rgba(0,0,0,0.35)", transform: "rotate(-1.5deg)" }}>
        {rows.map((row, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 11, background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}` }}>
            <span style={{ width: 26, height: 26, borderRadius: 8, flexShrink: 0, display: "grid", placeItems: "center", background: `linear-gradient(135deg, ${row.c}, #6d28d9)`, color: "#fff" }}>
              <KeyRound size={13} />
            </span>
            <span style={{ width: row.w, height: 7, borderRadius: 99, background: "rgba(255,255,255,0.3)" }} />
            <span style={{ marginLeft: "auto", fontFamily: C.mono, fontSize: 12, letterSpacing: "0.12em", color: "rgba(196,181,253,0.7)" }}>••••••</span>
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: C.success, paddingTop: 2 }}>
          <ShieldCheck size={13} /> Encrypted
        </div>
      </div>
    </div>
  );
}

function Tile({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <span style={{ width: 64, height: 64, borderRadius: 18, display: "grid", placeItems: "center", background: "linear-gradient(135deg, #8b5cf6, #6d28d9)", color: "#fff", border: "3px solid #0b0f19", boxShadow: "0 14px 34px rgba(124,58,237,0.45)", ...style }}>
      {children}
    </span>
  );
}

const fieldStyle = { display: "flex", flexDirection: "column" as const, gap: 5, flex: "1 1 220px", minWidth: 0 };
const labelStyle = { fontSize: "0.72rem", fontWeight: 600, color: C.muted };
