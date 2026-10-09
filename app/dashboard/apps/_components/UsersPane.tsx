"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type AppEnv } from "./api";
import { C, Button, Panel, Notice, Empty, EnvSwitch, inputStyle, timeAgo } from "./ui";

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
      else setError(err instanceof ApiError ? err.message : "Couldn't load users.");
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 1100 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: "1rem", flex: 1 }}>Users</h2>
        <EnvSwitch value={env} onChange={(v) => { setEnv(v); setOffset(0); }} />
      </div>
      <p style={{ margin: 0, color: C.muted, fontSize: "0.78rem" }}>
        People who've signed up to {env === "dev" ? "your app's preview" : "your live app"}. Preview and live have separate accounts.
      </p>
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      <Panel title="Invite someone" description="They get an email with a one-click sign-in link. Great for invite-only apps and admins.">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!inviteEmail.trim()) return;
            void act("invite", () => api(`${base}?env=${env}`, { method: "POST", json: { email: inviteEmail.trim(), role: inviteRole } }), `Invitation sent to ${inviteEmail.trim()}.`).then(() => setInviteEmail(""));
          }}
          style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
        >
          <input aria-label="Email to invite" type="email" placeholder="name@example.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} style={{ ...inputStyle, flex: "1 1 220px", width: "auto" }} />
          <RoleInput value={inviteRole} onChange={setInviteRole} />
          <Button type="submit" variant="primary" disabled={busy === "invite" || !inviteEmail.trim()}>
            {busy === "invite" ? "Sending…" : "Send invite"}
          </Button>
        </form>
      </Panel>

      <Panel>
        <input aria-label="Search users" placeholder="Search by email or profile…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...inputStyle, marginBottom: 10 }} />
        {error ? (
          <Notice tone="danger">{error}</Notice>
        ) : !data ? (
          <Empty title="Loading users…" />
        ) : data.users.length === 0 ? (
          <Empty title={query ? "No one matches that search." : "No users yet"}>{query ? null : "When people sign up to your app, they appear here."}</Empty>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
              <thead>
                <tr style={{ color: C.muted, textAlign: "left" }}>
                  {["Email", "Role", "Status", "Last sign-in", "Joined", ""].map((h) => (
                    <th key={h} style={{ padding: "0.45rem 0.5rem", borderBottom: `1px solid ${C.border}`, fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.users.map((u) => (
                  <tr key={u.id} style={{ borderBottom: `1px solid ${C.border}`, opacity: busy === u.id ? 0.6 : 1 }}>
                    <td style={cell}>
                      {u.email}
                      {!u.email_verified && <span style={{ marginLeft: 6, color: C.warning, fontSize: "0.7rem" }}>unverified</span>}
                    </td>
                    <td style={cell}>
                      <RoleInput
                        value={u.role}
                        onChange={(role) => role !== u.role && void act(u.id, () => api(`${base}/${u.id}?env=${env}`, { method: "PATCH", json: { role } }), `${u.email} is now "${role}". They'll need to sign in again.`)}
                      />
                    </td>
                    <td style={{ ...cell, color: u.disabled ? C.danger : C.success }}>{u.disabled ? "Disabled" : "Active"}</td>
                    <td style={cell}>{timeAgo(u.lastSignInAt)}</td>
                    <td style={cell}>{timeAgo(u.created_at)}</td>
                    <td style={{ ...cell, whiteSpace: "nowrap", textAlign: "right" }}>
                      <Button size="sm" variant="ghost" disabled={busy === u.id} onClick={() => void act(u.id, () => api(`${base}/${u.id}?env=${env}`, { method: "PATCH", json: { disabled: !u.disabled } }), u.disabled ? `${u.email} can sign in again.` : `${u.email} is disabled and signed out.`)}>
                        {u.disabled ? "Enable" : "Disable"}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={busy === u.id}
                        onClick={() => {
                          if (!window.confirm(`Delete ${u.email}? Their account is removed, and data your app linked to them (with "on delete cascade") goes too. This can't be undone.`)) return;
                          void act(u.id, () => api(`${base}/${u.id}?env=${env}`, { method: "DELETE" }), `${u.email} was deleted.`);
                        }}
                      >
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: "0.76rem", color: C.muted }}>
              <span style={{ flex: 1 }}>
                {offset + 1}–{offset + data.users.length} of {data.total}
              </span>
              <Button size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</Button>
              <Button size="sm" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>Next</Button>
            </div>
          </div>
        )}
      </Panel>
    </div>
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
