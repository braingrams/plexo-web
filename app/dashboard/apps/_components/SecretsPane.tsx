"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff, KeyRound, Trash2 } from "lucide-react";
import { api, ApiError } from "./api";
import { Button, C, Empty, Notice, Panel, inputStyle, timeAgo } from "./ui";

type Scope = "all" | "dev" | "live";
type Secret = { name: string; scope: Scope; hint: string | null; updatedAt: string };

const SCOPE_LABEL: Record<Scope, string> = { all: "All", dev: "Preview only", live: "Live only" };
const NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;

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
      if (mine === seq.current) setLoadError(err instanceof ApiError ? err.message : "Couldn't load secrets.");
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
    requestAnimationFrame(() => valueRef.current?.focus());
  }, [addName]);

  const problem = nameProblem(name);
  const replacing = !!secrets?.some((s) => s.name === name && s.scope === scope);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (!name) return setFormError("Give the secret a name, like STRIPE_SECRET_KEY.");
    if (problem) return setFormError(problem);
    if (!value) return setFormError("Paste the secret's value.");
    setSaving(true);
    setFormError(null);
    try {
      await api(`/api/v1/apps/${appId}/secrets`, { method: "PUT", json: { name, value, scope } });
      setMessage(`${replacing ? "Replaced" : "Saved"} ${name}. Your server functions will pick it up within a few minutes.`);
      setName("");
      setValue("");
      setShowValue(false);
      setScope("all");
      await load();
      nameRef.current?.focus();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Couldn't save the secret.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (s: Secret) => {
    const where = s.scope === "all" ? "" : ` (${SCOPE_LABEL[s.scope]})`;
    if (!window.confirm(`Delete ${s.name}${where}? Server functions that use it will stop working until you add it again.`)) return;
    const key = `${s.name}:${s.scope}`;
    setDeleting(key);
    setMessage(null);
    try {
      await api(`/api/v1/apps/${appId}/secrets`, { method: "DELETE", json: { name: s.name, scope: s.scope } });
      setSecrets((prev) => prev?.filter((x) => !(x.name === s.name && x.scope === s.scope)) ?? prev);
      setMessage(`Deleted ${s.name}.`);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Couldn't delete the secret.");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 440px), 1fr))", alignItems: "start", gap: "0.9rem", padding: "1rem" }}>
      <Panel
        title={replacing ? "Replace a secret" : "Add a secret"}
        description={
          <>
            API keys and passwords your server functions need. Values are encrypted and never shown again — not even to you. Your functions read them as{" "}
            <code style={{ fontFamily: C.mono, color: C.text }}>ctx.env.{name || "NAME"}</code>. Changes take effect within a few minutes; no rebuild needed.
          </>
        }
      >
        <form onSubmit={save} noValidate style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.7rem" }}>
            <label style={fieldStyle}>
              <span style={labelStyle}>Name</span>
              <input
                ref={nameRef}
                value={name}
                onChange={(e) => {
                  setName(e.target.value.toUpperCase().replace(/[\s-]+/g, "_"));
                  setFormError(null);
                }}
                placeholder="STRIPE_SECRET_KEY"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={!!problem}
                aria-describedby={problem ? "secret-name-problem" : undefined}
                style={{ ...inputStyle, fontFamily: C.mono, borderColor: problem ? "rgba(248,113,113,0.5)" : C.border }}
              />
              {problem && (
                <span id="secret-name-problem" style={{ fontSize: "0.7rem", color: C.danger }}>
                  {problem}
                </span>
              )}
            </label>
            <label style={{ ...fieldStyle, flex: "0 1 160px" }}>
              <span style={labelStyle}>Used by</span>
              <select value={scope} onChange={(e) => setScope(e.target.value as Scope)} style={inputStyle}>
                <option value="all">Preview and Live</option>
                <option value="dev">Preview only</option>
                <option value="live">Live only</option>
              </select>
            </label>
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={labelStyle}>Value</span>
            <span style={{ position: "relative", display: "block" }}>
              <input
                ref={valueRef}
                type={showValue ? "text" : "password"}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setFormError(null);
                }}
                placeholder="Paste the key here"
                autoComplete="new-password"
                spellCheck={false}
                style={{ ...inputStyle, fontFamily: C.mono, paddingRight: "2.4rem" }}
              />
              <button
                type="button"
                onClick={() => setShowValue((v) => !v)}
                aria-label={showValue ? "Hide value" : "Show value"}
                aria-pressed={showValue}
                style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: C.muted, cursor: "pointer", padding: 4, display: "flex" }}
              >
                {showValue ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </span>
          </label>
          {replacing && <Notice tone="warning">{name} already exists for {SCOPE_LABEL[scope] === "All" ? "Preview and Live" : SCOPE_LABEL[scope]} — saving replaces its value.</Notice>}
          {formError && <Notice tone="danger">{formError}</Notice>}
          {message && (
            <div role="status">
              <Notice tone="success">{message}</Notice>
            </div>
          )}
          <div>
            <Button type="submit" variant="primary" disabled={saving}>
              <KeyRound size={14} aria-hidden /> {saving ? "Saving…" : replacing ? "Replace secret" : "Save secret"}
            </Button>
          </div>
        </form>
      </Panel>

      <Panel title="Saved secrets">
        {loadError && (
          <div style={{ marginBottom: "0.6rem" }}>
            <Notice tone="danger">{loadError}</Notice>
          </div>
        )}
        {secrets === null ? (
          !loadError && <p style={{ margin: 0, fontSize: "0.78rem", color: C.muted }}>Loading…</p>
        ) : secrets.length === 0 ? (
          <Empty title="No secrets yet">When your app needs an API key (Stripe, OpenAI, an email service…), add it above — or SOL will ask you for it.</Empty>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {secrets.map((s) => {
              const key = `${s.name}:${s.scope}`;
              return (
                <li key={key} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.4rem 0.8rem", padding: "0.6rem 0", borderTop: `1px solid ${C.border}` }}>
                  <span style={{ fontFamily: C.mono, fontSize: "0.8rem", fontWeight: 600, color: C.text, flex: "1 1 180px", minWidth: 0, overflowWrap: "anywhere" }}>{s.name}</span>
                  <span style={{ fontSize: "0.7rem", padding: "0.1rem 0.45rem", borderRadius: 6, background: "rgba(255,255,255,0.06)", color: C.muted }}>{SCOPE_LABEL[s.scope]}</span>
                  <span style={{ fontFamily: C.mono, fontSize: "0.74rem", color: C.faint, minWidth: 56 }} title="The last few characters, so you can tell keys apart">
                    {s.hint ? `…${s.hint}` : "••••"}
                  </span>
                  <span style={{ fontSize: "0.72rem", color: C.faint, minWidth: 70 }}>Updated {timeAgo(s.updatedAt)}</span>
                  <span style={{ display: "flex", gap: 4 }}>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setName(s.name);
                        setScope(s.scope);
                        setValue("");
                        setMessage(null);
                        valueRef.current?.focus();
                      }}
                    >
                      Replace
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => void remove(s)} disabled={deleting === key} aria-label={`Delete ${s.name}`}>
                      <Trash2 size={13} aria-hidden />
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}

const fieldStyle = { display: "flex", flexDirection: "column" as const, gap: 4, flex: "1 1 220px", minWidth: 0 };
const labelStyle = { fontSize: "0.72rem", fontWeight: 600, color: C.muted };
