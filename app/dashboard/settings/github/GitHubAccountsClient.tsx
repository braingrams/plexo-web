"use client";

import { useEffect, useState, type CSSProperties } from "react";

// Settings → GitHub: the accounts this workspace has connected, and a full revoke for each. Revoking removes
// Plexo's access on GitHub and stops every app that syncs from that account. The apps keep their current files.
export function GitHubAccountsClient() {
  const [accounts, setAccounts] = useState<GitHubAccount[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/v1/github/installations");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.error ?? `GitHub accounts couldn't be loaded (server responded ${res.status}).`);
    setAccounts(data.installations);
  }

  useEffect(() => {
    void load();
  }, []);

  async function revoke(account: GitHubAccount) {
    const apps = account.linkedApps;
    const message = apps > 0
      ? `Revoke ${account.account}? Plexo will be removed from that GitHub account, and ${apps} ${apps === 1 ? "app" : "apps"} will stop syncing from it. Their current files stay.`
      : `Revoke ${account.account}? Plexo will be removed from that GitHub account.`;
    if (!window.confirm(message)) return;
    setBusyId(account.id);
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/v1/github/installations?installationId=${account.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok) return setError(data.error ?? `Revoking failed (server responded ${res.status}).`);
    setNotice(`${account.account} is revoked. ${data.unlinkedApps ?? 0} ${data.unlinkedApps === 1 ? "app was" : "apps were"} unlinked.`);
    await load();
  }

  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 720 }}>
      <div>
        <h2 style={{ margin: "0 0 4px", fontSize: 17, fontWeight: 700, color: "var(--text-main)" }}>GitHub accounts</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
          Accounts this workspace has connected to Plexo. Revoking one removes Plexo from it on GitHub.
        </p>
      </div>

      {accounts === null && !error ? <p style={hint}>Loading…</p> : null}
      {accounts !== null && accounts.length === 0 ? (
        <p style={hint}>No GitHub accounts are connected. Connect one from an app&apos;s detail page.</p>
      ) : null}

      {accounts?.map((account) => (
        <div key={account.id} style={row}>
          <div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text-main)" }}>{account.account}</p>
            <p style={hint}>
              {account.type === "Organization" ? "Organisation" : "Personal account"} · {account.linkedApps}{" "}
              {account.linkedApps === 1 ? "app" : "apps"} synced from it
            </p>
          </div>
          <button type="button" onClick={() => void revoke(account)} disabled={busyId !== null} style={revokeButton(busyId === null)}>
            {busyId === account.id ? "Revoking…" : "Revoke"}
          </button>
        </div>
      ))}

      {notice ? <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-muted)" }}>{notice}</p> : null}
      {error ? <p style={{ margin: 0, fontSize: 12.5, color: "#f87171" }}>{error}</p> : null}
    </div>
  );
}

type GitHubAccount = { id: number; account: string; type: string | null; linkedApps: number };

const hint: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 };
const row: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "12px 14px",
  borderRadius: 10,
  border: "1px solid var(--surface-border)",
  background: "var(--surface)",
};

function revokeButton(enabled: boolean): CSSProperties {
  return {
    padding: "8px 14px",
    borderRadius: 9,
    border: "1px solid #f87171",
    background: "transparent",
    color: "#f87171",
    fontWeight: 650,
    fontSize: 13,
    cursor: enabled ? "pointer" : "not-allowed",
  };
}
