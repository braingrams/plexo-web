"use client";

import { useCallback, useEffect, useState } from "react";

type Status = { available: boolean; phone: string | null };
type Pairing = { code: string; link: string; qr: string; expiresAt: string; number: string };

const pill = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.45rem",
  padding: "0.6rem 1.1rem",
  borderRadius: 999,
  fontFamily: "inherit",
  fontSize: "0.83rem",
  fontWeight: 700,
  cursor: "pointer",
  textDecoration: "none",
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.05)",
  color: "#f5f5ff",
} as const;

const primary = { ...pill, border: "none", background: "linear-gradient(135deg,#25d366,#128c7e)", color: "#fff" } as const;

function pretty(phone: string): string {
  return `+${phone}`;
}

/** "Chat with SOL on WhatsApp": one tap opens WhatsApp with the connect message already typed. While it
 * waits, the card polls so it flips to "Connected" the moment the person hits Send. */
export function WhatsAppConnect() {
  const [status, setStatus] = useState<Status | null>(null);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/sol/whatsapp", { cache: "no-store" });
      if (res.ok) setStatus((await res.json()) as Status);
    } catch {
      /* keep the last known state */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!pairing || status?.phone) return;
    const timer = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(timer);
  }, [pairing, status?.phone, load]);

  useEffect(() => {
    if (status?.phone) setPairing(null);
  }, [status?.phone]);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/sol/whatsapp", { method: "POST" });
      const data = (await res.json().catch(() => null)) as (Pairing & { error?: string }) | null;
      if (!res.ok || !data?.link) throw new Error(data?.error ?? "Couldn't start the connection. Try again.");
      setPairing(data);
      window.open(data.link, "_blank", "noopener");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start the connection. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/sol/whatsapp", { method: "DELETE" });
      if (!res.ok) throw new Error("Couldn't disconnect. Try again.");
      setStatus((s) => (s ? { ...s, phone: null } : s));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't disconnect. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!status) return <span style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.4)" }}>Checking…</span>;

  if (!status.available) {
    return <span style={{ fontSize: "0.82rem", color: "rgba(240,242,255,0.5)" }}>Coming soon — we're finishing the setup.</span>;
  }

  if (status.phone) {
    return (
      <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.5rem" }}>
        <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#34d399" }}>● Connected to {pretty(status.phone)}</span>
        <button type="button" style={pill} onClick={disconnect} disabled={busy}>
          Disconnect
        </button>
        {error && <span style={{ fontSize: "0.76rem", color: "#f87171" }}>{error}</span>}
      </div>
    );
  }

  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.55rem", textAlign: "right" }}>
      <button type="button" style={primary} onClick={connect} disabled={busy}>
        {pairing ? "Open WhatsApp again" : "Connect WhatsApp"}
      </button>
      {pairing && (
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <p style={{ margin: 0, maxWidth: 320, fontSize: "0.78rem", lineHeight: 1.55, color: "rgba(240,242,255,0.6)" }}>
            WhatsApp should have opened with <strong style={{ color: "#f5f5ff" }}>LINK {pairing.code}</strong> ready to send — just tap Send. On a computer? Scan the code with your
            phone's camera instead. Still nothing? Send that message to <strong style={{ color: "#f5f5ff" }}>+{pairing.number}</strong>. The code works for 15 minutes.
          </p>
          {/* White tile so it scans in dark mode too. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pairing.qr} alt={`QR code that opens WhatsApp with LINK ${pairing.code} ready to send`} width={132} height={132} style={{ borderRadius: 12, background: "#fff", padding: 6, flexShrink: 0 }} />
        </div>
      )}
      {error && <span style={{ fontSize: "0.76rem", color: "#f87171" }}>{error}</span>}
    </div>
  );
}
