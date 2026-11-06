"use client";

import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";

// Settings for a server-rendered app (ULTRA). Two kinds, kept apart on purpose:
//   Variables: visible settings. Their values are shown here. A variable marked "needed at build"
//              (or named with a public prefix such as NEXT_PUBLIC_) is baked into the app, so visitors can read it.
//   Secrets:   write-only. The value is never shown again, only a short hint. The server fetches
//              secrets when it starts. Secrets never go to the build.

type Scope = "all" | "dev" | "live";
type Variable = { name: string; scope: Scope; value: string; buildTime: boolean; updatedAt: string | null };
type Secret = { name: string; scope: Scope; hint: string | null; updatedAt: string };
type RebuildState = { needsRebuild: boolean; hasSource: boolean };

const PUBLIC_PREFIXES = ["NEXT_PUBLIC_", "NUXT_PUBLIC_", "VITE_", "PUBLIC_", "REACT_APP_"];
const SCOPE_LABEL: Record<Scope, string> = { all: "Preview and Live", dev: "Preview only", live: "Live only" };
const NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;

const card: CSSProperties = { border: "1px solid rgba(255,255,255,0.09)", borderRadius: 14, padding: "20px 22px", marginBottom: 16 };
const heading: CSSProperties = { margin: "0 0 4px", fontSize: 15, fontWeight: 700 };
const muted: CSSProperties = { margin: "0 0 14px", fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 };
const input: CSSProperties = { padding: "9px 11px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.03)", color: "var(--text-main)", fontFamily: "inherit", fontSize: 13 };
const button = (enabled: boolean): CSSProperties => ({
  padding: "8px 14px", borderRadius: 9, border: "none", fontWeight: 650, fontSize: 13,
  cursor: enabled ? "pointer" : "not-allowed", background: enabled ? "var(--brand)" : "rgba(255,255,255,0.08)", color: enabled ? "#fff" : "var(--text-muted)",
});
const ghost: CSSProperties = { background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 12.5, padding: 4 };
const warn: CSSProperties = { margin: "8px 0 0", fontSize: 12.5, color: "#fbbf24" };

async function call<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, status: res.status, error: json.error ?? `Request failed (${res.status}).` };
  return { ok: true, data: json as T };
}

export function ServerSettingsPanel({ templateId }: { templateId: string }) {
  const base = `/api/v1/templates/${templateId}`;
  const [locked, setLocked] = useState<string | null>(null);
  const [variables, setVariables] = useState<Variable[]>([]);
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [rebuild, setRebuild] = useState<RebuildState>({ needsRebuild: false, hasSource: false });
  const [rebuilding, setRebuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [vName, setVName] = useState("");
  const [vValue, setVValue] = useState("");
  const [vScope, setVScope] = useState<Scope>("all");
  const [vBuild, setVBuild] = useState(false);

  const [sName, setSName] = useState("");
  const [sValue, setSValue] = useState("");
  const [sScope, setSScope] = useState<Scope>("all");

  const load = useCallback(async () => {
    const [v, s] = await Promise.all([
      call<{ variables: Variable[] }>(`${base}/ssr-variables`),
      call<{ secrets: Secret[] } & RebuildState>(`${base}/ssr-secrets`),
    ]);
    if (!v.ok && v.status === 403) return setLocked(v.error);
    if (v.ok) setVariables(v.data.variables);
    if (s.ok) {
      setSecrets(s.data.secrets);
      setRebuild({ needsRebuild: s.data.needsRebuild, hasSource: s.data.hasSource });
    }
    if (!v.ok) setError(v.error);
  }, [base]);

  useEffect(() => { void load(); }, [load]);

  const publicName = PUBLIC_PREFIXES.some((p) => vName.startsWith(p));
  const secretPublic = PUBLIC_PREFIXES.some((p) => sName.startsWith(p));
  const vNameOk = NAME_RE.test(vName);
  const sNameOk = NAME_RE.test(sName);

  async function saveVariable(e: FormEvent) {
    e.preventDefault();
    setError(null); setNotice(null);
    const res = await call<{ warning: string | null }>(`${base}/ssr-variables`, {
      method: "PUT", body: JSON.stringify({ name: vName, value: vValue, scope: vScope, buildTime: vBuild || publicName }),
    });
    if (!res.ok) return setError(res.error);
    setNotice(res.data.warning ?? (vBuild || publicName ? "Saved. Build-time variables take effect on the next rebuild." : "Saved."));
    setVName(""); setVValue(""); setVBuild(false);
    await load();
  }

  async function deleteVariable(v: Variable) {
    const res = await call(`${base}/ssr-variables?name=${encodeURIComponent(v.name)}&scope=${v.scope}`, { method: "DELETE" });
    if (!res.ok) return setError(res.error);
    await load();
  }

  async function saveSecret(e: FormEvent) {
    e.preventDefault();
    setError(null); setNotice(null);
    const res = await call<{ note: string }>(`${base}/ssr-secrets`, { method: "PUT", body: JSON.stringify({ name: sName, value: sValue, scope: sScope }) });
    if (!res.ok) return setError(res.error);
    setNotice(res.data.note);
    setSName(""); setSValue("");
    await load();
  }

  async function deleteSecret(s: Secret) {
    setError(null); setNotice(null);
    const res = await call<{ note: string }>(`${base}/ssr-secrets?name=${encodeURIComponent(s.name)}&scope=${s.scope}`, { method: "DELETE" });
    if (!res.ok) return setError(res.error);
    setNotice(res.data.note);
    await load();
  }

  // Queues a build from the stored source. Secret changes take effect once it's published.
  async function rebuildNow() {
    setError(null); setNotice(null); setRebuilding(true);
    const res = await call<{ message: string; warnings: string[] }>(`${base}/ssr-rebuild`, { method: "POST" });
    setRebuilding(false);
    if (!res.ok) return setError(res.error);
    setNotice([res.data.message, ...res.data.warnings].join(" "));
    await load();
  }

  if (locked) {
    return (
      <div style={card}>
        <h3 style={heading}>Server app settings</h3>
        <p style={muted}>{locked}</p>
      </div>
    );
  }

  return (
    <div>
      {error ? <p style={{ ...warn, color: "#f87171", margin: "0 0 12px" }}>{error}</p> : null}
      {notice ? <p style={{ ...warn, color: "var(--brand)", margin: "0 0 12px" }}>{notice}</p> : null}

      <div style={card}>
        <h3 style={heading}>Variables</h3>
        <p style={muted}>
          Visible settings, shown in full here. Anything marked "needed at build", or named with a public prefix
          (NEXT_PUBLIC_, VITE_, …), is baked into the app, so visitors can read it. Changes to build-time
          variables take effect on the next rebuild.
        </p>
        {variables.length === 0 ? <p style={muted}>No variables yet.</p> : (
          <div style={{ display: "grid", gap: 6, marginBottom: 14 }}>
            {variables.map((v) => (
              <div key={`${v.name}-${v.scope}`} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 130px auto auto", gap: 10, alignItems: "center", fontSize: 13 }}>
                <span style={{ fontFamily: "var(--font-mono)" }}>{v.name}</span>
                <span style={{ fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis" }}>{v.value}</span>
                <span style={{ color: "var(--text-muted)" }}>{SCOPE_LABEL[v.scope]}</span>
                <span style={{ fontSize: 12, color: v.buildTime || PUBLIC_PREFIXES.some((p) => v.name.startsWith(p)) ? "#fbbf24" : "var(--text-muted)" }}>
                  {v.buildTime || PUBLIC_PREFIXES.some((p) => v.name.startsWith(p)) ? "Build" : "Runtime"}
                </span>
                <button type="button" onClick={() => void deleteVariable(v)} style={ghost}>Remove</button>
              </div>
            ))}
          </div>
        )}
        <form onSubmit={(e) => void saveVariable(e)} style={{ display: "grid", gap: 10, maxWidth: 560 }}>
          <input style={input} placeholder="NAME" value={vName} onChange={(e) => setVName(e.target.value.toUpperCase())} />
          <input style={input} placeholder="Value" value={vValue} onChange={(e) => setVValue(e.target.value)} />
          <select style={input} value={vScope} onChange={(e) => setVScope(e.target.value as Scope)}>
            <option value="all">Preview and Live</option>
            <option value="dev">Preview only</option>
            <option value="live">Live only</option>
          </select>
          <label style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={vBuild || publicName} disabled={publicName} onChange={(e) => setVBuild(e.target.checked)} />
            Needed at build (baked into the app)
          </label>
          {publicName ? <p style={warn}>This name is public: browsers can read it, so it's always set at build time.</p> : null}
          {vName && !vNameOk ? <p style={warn}>Use capital letters, numbers and underscores, starting with a letter.</p> : null}
          <div><button type="submit" disabled={!vNameOk || !vValue} style={button(vNameOk && !!vValue)}>Save variable</button></div>
        </form>
      </div>

      <div style={card}>
        <h3 style={heading}>Secrets</h3>
        <p style={muted}>
          Write-only: a value is never shown again, only its last four characters. A running server keeps the values
          it started with. After a change, rebuild to restart it with the current values. Secrets are never used in the
          build. Anything the build needs goes in Variables, where it's visible.
        </p>
        {rebuild.needsRebuild ? (
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 14, padding: "10px 12px", borderRadius: 10, background: "rgba(251,191,36,0.08)" }}>
            <span style={{ fontSize: 13, color: "#fbbf24" }}>
              {rebuild.hasSource ? "A secret changed. Rebuild to apply it." : "A secret changed. Upload the project to rebuild."}
            </span>
            {rebuild.hasSource ? (
              <button type="button" onClick={() => void rebuildNow()} disabled={rebuilding} style={button(!rebuilding)}>
                {rebuilding ? "Queuing…" : "Rebuild"}
              </button>
            ) : null}
          </div>
        ) : null}
        {secrets.length === 0 ? <p style={muted}>No secrets yet.</p> : (
          <div style={{ display: "grid", gap: 6, marginBottom: 14 }}>
            {secrets.map((s) => (
              <div key={`${s.name}-${s.scope}`} style={{ display: "grid", gridTemplateColumns: "1fr 130px 90px auto", gap: 10, alignItems: "center", fontSize: 13 }}>
                <span style={{ fontFamily: "var(--font-mono)" }}>{s.name}</span>
                <span style={{ color: "var(--text-muted)" }}>{SCOPE_LABEL[s.scope]}</span>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>{s.hint ? `…${s.hint}` : "set"}</span>
                <button type="button" onClick={() => void deleteSecret(s)} style={ghost}>Remove</button>
              </div>
            ))}
          </div>
        )}
        <form onSubmit={(e) => void saveSecret(e)} style={{ display: "grid", gap: 10, maxWidth: 560 }}>
          <input style={input} placeholder="NAME" value={sName} onChange={(e) => setSName(e.target.value.toUpperCase())} />
          <input style={input} type="password" placeholder="Value (write-only)" autoComplete="off" value={sValue} onChange={(e) => setSValue(e.target.value)} />
          <select style={input} value={sScope} onChange={(e) => setSScope(e.target.value as Scope)}>
            <option value="all">Preview and Live</option>
            <option value="dev">Preview only</option>
            <option value="live">Live only</option>
          </select>
          {secretPublic ? <p style={warn}>This name starts with a public prefix, so browsers could read it. Add it under Variables instead.</p> : null}
          <div><button type="submit" disabled={!sNameOk || !sValue || secretPublic} style={button(sNameOk && !!sValue && !secretPublic)}>Save secret</button></div>
        </form>
      </div>
    </div>
  );
}
