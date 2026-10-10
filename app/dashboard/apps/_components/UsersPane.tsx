"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type AppEnv } from "./api";
import { CloudOff, LogIn, Mail, Pause, Play, RefreshCw, Search, Trash2, UserPlus, Users } from "lucide-react";
import { C, Button, Notice, Empty, EnvSwitch, PaneHeader, IconButton, Pill, StateStyles, HUES, hueGradient, inputStyle, timeAgo } from "./ui";

// The app's own visitor accounts — people who signed up to the app, not Plexo users.

type AppUser = {
  id: string;
  email: string;
  role: string;
  email_verified: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  disabled: boolean;
  lastSignInAt: string | null;
  hasPassword: boolean;
};

const PAGE = 50;
const COMMON_ROLES = ["user", "member", "admin"];

export function UsersPane(props: { appId: string }) {
  const { appId } = props;
  const [env, setEnv] = useState<AppEnv>("dev");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ users: AppUser[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("user");
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [inviting, setInviting] = useState(false);
  const request = useRef(0);

  const load = useCallback(async () => {
    const id = ++request.current;
    setError(null);
    try {
      const res = await api<{ users: AppUser[]; total: number }>(`/api/v1/apps/${appId}/users?env=${env}&limit=${PAGE}&offset=${offset}${query ? `&search=${encodeURIComponent(query)}` : ""}`);
      if (id === request.current) setData(res);
    } catch (err) {
      if (id !== request.current) return;
      if (err instanceof ApiError && err.status === 503) setError("Your database is waking up — this takes a few seconds the first time after a quiet period. Try again in a moment.");
      else setError(err instanceof ApiError && err.status < 500 ? err.message : "Something went wrong on our side.");
    }
  }, [appId, env, offset, query]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const t = setTimeout(() => {
      setOffset(0);
      setQuery(search.trim());
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  async function act(userId: string, run: () => Promise<unknown>, done: string) {
    setBusy(userId);
    setNotice(null);
    try {
      await run();
      setNotice({ tone: "success", text: done });
      await load();
    } catch (err) {
      setNotice({ tone: "danger", text: err instanceof ApiError ? err.message : "That didn't work." });
    } finally {
      setBusy(null);
    }
  }

  const base = `/api/v1/apps/${appId}/users`;

  const noOneYet = !!data && data.total === 0 && !query;
  const inviteForm = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!inviteEmail.trim()) return;
        void act("invite", () => api(`${base}?env=${env}`, { method: "POST", json: { email: inviteEmail.trim(), role: inviteRole } }), `Invitation sent to ${inviteEmail.trim()}.`).then(() => setInviteEmail(""));
      }}
      style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
    >
      <input aria-label="Email to invite" type="email" autoFocus placeholder="name@example.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} style={{ ...inputStyle, flex: "1 1 240px", width: "auto" }} />
      <RoleInput value={inviteRole} onChange={setInviteRole} />
      <Button type="submit" variant="primary" disabled={busy === "invite" || !inviteEmail.trim()}>
        {busy === "invite" ? "Sending…" : "Send invite"}
      </Button>
    </form>
  );

  const weekAgo = Date.now() - 7 * 86_400_000;
  const wholeList = !!data && !query && data.total <= PAGE && offset === 0;
  const stats = data && data.total > 0 && !query
    ? [
        { label: env === "dev" ? "People in Preview" : "People", value: data.total, color: "#8b5cf6", icon: Users },
        ...(wholeList
          ? [
              { label: "Joined this week", value: data.users.filter((u) => Date.parse(u.created_at) > weekAgo).length, color: "#6366f1", icon: Sparkline },
              { label: "Signed in this week", value: data.users.filter((u) => u.lastSignInAt && Date.parse(u.lastSignInAt) > weekAgo).length, color: "#7c3aed", icon: LogIn },
            ]
          : []),
      ]
    : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <style>{PEOPLE_CSS}</style>
      <StateStyles />
      <PaneHeader
        title="People"
        subtitle={`Everyone who has an account on ${env === "dev" ? "your app's preview" : "your live app"}. Preview and live keep separate accounts.`}
        actions={
          <>
            <EnvSwitch value={env} onChange={(v) => { setEnv(v); setOffset(0); setData(null); }} />
            {!noOneYet && data && (
              <Button variant={inviting ? "secondary" : "primary"} size="sm" onClick={() => setInviting((v) => !v)}>
                <UserPlus size={14} /> Invite
              </Button>
            )}
          </>
        }
      />
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      {error && !data ? (
        <section style={{ display: "flex", alignItems: "center", gap: "1.2rem", flexWrap: "wrap", padding: "1.8rem 2rem", borderRadius: 20, border: "1px solid rgba(251,191,36,0.3)", background: "rgba(251,191,36,0.05)" }}>
          <span style={{ width: 48, height: 48, borderRadius: 14, display: "grid", placeItems: "center", background: "rgba(251,191,36,0.14)", color: C.warning, flexShrink: 0 }}>
            <CloudOff size={22} />
          </span>
          <div style={{ flex: "1 1 320px", minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700 }}>We couldn&rsquo;t load your people just now</h3>
            <p style={{ margin: "0.3rem 0 0", fontSize: "0.84rem", color: C.muted, lineHeight: 1.55 }}>{error} Everyone&rsquo;s account is safe.</p>
          </div>
          <Button variant="primary" onClick={() => void load()}>
            <RefreshCw size={14} /> Try again
          </Button>
        </section>
      ) : !data ? (
        <div aria-busy="true" aria-label="Loading people" style={{ border: `1px solid ${C.border}`, borderRadius: 18, padding: "0.6rem 1rem" }}>
          {[62, 48, 70, 54, 44].map((w, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "0.8rem 0", borderBottom: i < 4 ? `1px solid ${C.border}` : "none" }}>
              <span className="ppl-skel" style={{ width: 36, height: 36, borderRadius: 99, flexShrink: 0 }} />
              <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
                <span className="ppl-skel" style={{ height: 11, width: `${w}%`, borderRadius: 99 }} />
                <span className="ppl-skel" style={{ height: 8, width: "22%", borderRadius: 99 }} />
              </span>
              <span className="ppl-skel" style={{ height: 22, width: 64, borderRadius: 99 }} />
            </div>
          ))}
        </div>
      ) : noOneYet ? (
        <section className="ppl-empty" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 0.8fr)", gap: "2rem", alignItems: "center", padding: "clamp(1.2rem, 4.5vw, 2.2rem)", borderRadius: 20, border: `1px solid ${C.border}`, background: "radial-gradient(70% 90% at 100% 0%, rgba(99,102,241,0.12), transparent 60%), radial-gradient(60% 80% at 0% 100%, rgba(139,92,246,0.1), transparent 60%), rgba(255,255,255,0.015)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "1.2rem", minWidth: 0 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "clamp(1.1rem, 4.2vw, 1.35rem)", fontWeight: 750, letterSpacing: "-0.01em" }}>No one has signed up yet</h3>
              <p style={{ margin: "0.45rem 0 0", fontSize: "0.88rem", color: C.muted, lineHeight: 1.6, maxWidth: 520 }}>
                When people create an account on your app, they&rsquo;ll show up here. You can change what they&rsquo;re allowed to do, pause them, or remove them. Want someone in right away? Send them an invite — they get a one-click sign-in link.
              </p>
            </div>
            {inviteForm}
          </div>
          <PeopleIllustration />
        </section>
      ) : (
        <>
          {stats.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              {stats.map(({ label, value, color, icon: Icon }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 14, padding: "1rem 1.1rem", borderRadius: 16, border: `1px solid ${C.border}`, background: `linear-gradient(135deg, ${color}1f, transparent 70%)` }}>
                  <span style={{ width: 40, height: 40, borderRadius: 12, display: "grid", placeItems: "center", background: `${color}2e`, color }}>
                    <Icon size={19} />
                  </span>
                  <span>
                    <span style={{ display: "block", fontSize: "clamp(1.15rem, 4.4vw, 1.45rem)", fontWeight: 750, lineHeight: 1.1 }}>{value.toLocaleString()}</span>
                    <span style={{ display: "block", fontSize: "0.76rem", color: C.muted, marginTop: 2 }}>{label}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
          {inviting && (
            <section style={{ padding: "1.1rem 1.2rem", borderRadius: 16, border: "1px solid rgba(139,92,246,0.3)", background: "rgba(139,92,246,0.06)", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: "0.9rem", fontWeight: 700 }}>Invite someone</div>
              {inviteForm}
            </section>
          )}
          <section style={{ border: `1px solid ${C.border}`, borderRadius: 18, background: C.panel, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0.8rem 1rem", borderBottom: `1px solid ${C.border}` }}>
              <Search size={15} color={C.muted} aria-hidden />
              <input aria-label="Search people" placeholder="Search by email…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", color: C.text, fontSize: "0.85rem", fontFamily: "inherit" }} />
            </div>
            {data.users.length === 0 ? (
              <Empty title="No one matches that search." />
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {data.users.map((u) => (
                  <li key={u.id} className="ppl-row" style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "0.75rem 1rem", borderBottom: `1px solid ${C.border}`, opacity: busy === u.id ? 0.55 : 1 }}>
                    <span aria-hidden style={{ width: 38, height: 38, borderRadius: 99, flexShrink: 0, display: "grid", placeItems: "center", background: hueGradient(u.email), color: "#fff", fontWeight: 750, fontSize: "0.9rem", opacity: u.disabled ? 0.45 : 1 }}>
                      {u.email.charAt(0).toUpperCase()}
                    </span>
                    <span style={{ flex: "1 1 220px", minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: "0.86rem", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.email}</span>
                      <span style={{ display: "block", fontSize: "0.74rem", color: C.muted, marginTop: 2 }}>
                        Joined {timeAgo(u.created_at)} · {u.lastSignInAt ? `last seen ${timeAgo(u.lastSignInAt)}` : "hasn't signed in yet"}
                      </span>
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {!u.email_verified && <Pill color={C.warning}>Email not confirmed</Pill>}
                      <Pill color={u.disabled ? C.danger : C.success}>{u.disabled ? "Paused" : "Active"}</Pill>
                      <RoleInput
                        value={u.role}
                        onChange={(role) => role !== u.role && void act(u.id, () => api(`${base}/${u.id}?env=${env}`, { method: "PATCH", json: { role } }), `${u.email} is now "${role}". They'll need to sign in again.`)}
                      />
                    </span>
                    <span style={{ display: "flex", gap: 4 }}>
                      <IconButton
                        label={u.disabled ? `Let ${u.email} sign in again` : `Pause ${u.email}`}
                        disabled={busy === u.id}
                        onClick={() => void act(u.id, () => api(`${base}/${u.id}?env=${env}`, { method: "PATCH", json: { disabled: !u.disabled } }), u.disabled ? `${u.email} can sign in again.` : `${u.email} is paused and signed out.`)}
                      >
                        {u.disabled ? <Play size={15} /> : <Pause size={15} />}
                      </IconButton>
                      <IconButton
                        label={`Remove ${u.email}`}
                        danger
                        disabled={busy === u.id}
                        onClick={() => {
                          if (!window.confirm(`Remove ${u.email}? Their account and anything your app saved for them is deleted. This can't be undone.`)) return;
                          void act(u.id, () => api(`${base}/${u.id}?env=${env}`, { method: "DELETE" }), `${u.email} was removed.`);
                        }}
                      >
                        <Trash2 size={15} />
                      </IconButton>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {data.total > PAGE && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0.7rem 1rem", fontSize: "0.76rem", color: C.muted }}>
                <span style={{ flex: 1 }}>
                  {offset + 1}–{offset + data.users.length} of {data.total}
                </span>
                <Button size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</Button>
                <Button size="sm" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>Next</Button>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/** A friendly picture of people joining. */
function PeopleIllustration() {
  const people = [
    { c: "#8b5cf6", x: 0, y: 18, s: 64 },
    { c: "#c084fc", x: 52, y: 0, s: 56 },
    { c: "#a78bfa", x: 98, y: 30, s: 60 },
    { c: "#6366f1", x: 40, y: 62, s: 52 },
  ];
  return (
    <div aria-hidden className="ppl-art" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
      <div style={{ position: "relative", width: 160, height: 120 }}>
        {people.map((p, i) => (
          <span key={i} style={{ position: "absolute", left: p.x, top: p.y, width: p.s, height: p.s, borderRadius: 99, background: `linear-gradient(135deg, ${p.c}, ${HUES[(HUES.indexOf(p.c) + 3) % HUES.length]})`, border: "3px solid #0b0f19", boxShadow: "0 10px 30px rgba(0,0,0,0.35)" }} />
        ))}
      </div>
      <div style={{ width: "100%", maxWidth: 260, borderRadius: 14, background: "rgba(11,15,25,0.6)", border: `1px solid ${C.borderStrong}`, padding: "0.8rem 0.9rem", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 30, height: 30, borderRadius: 99, background: "rgba(139,92,246,0.2)", display: "grid", placeItems: "center", color: "#c4b5fd" }}>
          <Mail size={15} />
        </span>
        <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ width: "70%", height: 7, borderRadius: 99, background: "rgba(255,255,255,0.35)" }} />
          <span style={{ width: "45%", height: 6, borderRadius: 99, background: "rgba(255,255,255,0.15)" }} />
        </span>
        <span style={{ padding: "4px 9px", borderRadius: 7, background: C.brand, fontSize: 10, fontWeight: 700, color: "#fff" }}>Join</span>
      </div>
    </div>
  );
}

const PEOPLE_CSS = `
.ppl-skel { background: linear-gradient(90deg, rgba(255,255,255,0.04), rgba(255,255,255,0.09), rgba(255,255,255,0.04)); background-size: 200% 100%; animation: ppl-shimmer 1.4s ease-in-out infinite; display: block; }
@keyframes ppl-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
.ppl-row { transition: background 0.15s; }
.ppl-row:hover { background: rgba(255,255,255,0.025); }
.ppl-row:last-child { border-bottom: none !important; }
@media (max-width: 1000px) { .ppl-empty { grid-template-columns: minmax(0, 1fr) !important; } .ppl-art { display: none !important; } }
@media (prefers-reduced-motion: reduce) { .ppl-skel { animation: none; } }
`;

/** A small rising-line icon, sized like the lucide ones beside it. */
function Sparkline({ size = 19 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="3 17 9 11 13 15 21 7" />
      <polyline points="15 7 21 7 21 13" />
    </svg>
  );
}

const cell = { padding: "0.45rem 0.5rem", verticalAlign: "middle" as const };

function RoleInput({ value, onChange }: { value: string; onChange: (role: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const listId = "plexo-app-roles";
  return (
    <>
      <input
        aria-label="Role"
        list={listId}
        value={draft}
        onChange={(e) => setDraft(e.target.value.toLowerCase())}
        onBlur={() => (/^[a-z][a-z0-9_-]{0,31}$/.test(draft) ? onChange(draft) : setDraft(value))}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        style={{ ...inputStyle, width: 110 }}
      />
      <datalist id={listId}>
        {COMMON_ROLES.map((r) => <option key={r} value={r} />)}
      </datalist>
    </>
  );
}
