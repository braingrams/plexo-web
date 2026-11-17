"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "../ui";

type Status = { available: boolean; phone: string | null };
type Pairing = { code: string; link: string; qr: string; expiresAt: string; number: string };

/** "Chat with SOL on WhatsApp" in the new look. Same calls as the classic one: one tap opens WhatsApp with the connect message typed; it polls so it flips to Connected the moment Send is pressed. */
export function WhatsAppV3() {
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
  useEffect(() => void load(), [load]);
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
      if (!res.ok || !data?.link) throw new Error(data?.error ?? "We couldn't start the connection. Please try again.");
      setPairing(data);
      window.open(data.link, "_blank", "noopener");
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't start the connection. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/sol/whatsapp", { method: "DELETE" });
      if (!res.ok) throw new Error("We couldn't disconnect. Please try again.");
      setStatus((s) => (s ? { ...s, phone: null } : s));
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't disconnect. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!status) return <span className="sol3-wa__note">Checking…</span>;
  if (!status.available) return <span className="sol3-wa__note">Coming soon. We&apos;re finishing the setup.</span>;

  if (status.phone) {
    return (
      <div className="sol3-wa">
        <span className="sol3-wa__ok">Connected to +{status.phone}</span>
        <Button variant="secondary" loading={busy} onClick={disconnect}>
          Disconnect
        </Button>
        {error ? <p className="sol3-wa__err" role="alert">{error}</p> : null}
      </div>
    );
  }
  return (
    <div className="sol3-wa">
      <Button loading={busy} onClick={connect}>
        {pairing ? "Open WhatsApp again" : "Connect WhatsApp"}
      </Button>
      {pairing ? (
        <div className="sol3-wa__pair">
          <p>
            WhatsApp should have opened with <b>LINK {pairing.code}</b> ready to send. Just tap Send. On a computer? Scan the code with your phone&apos;s camera instead. Still nothing? Send that message to <b>+{pairing.number}</b>. The code works for 15 minutes.
          </p>
          {/* A QR code has to be dark on real white to scan, in dark mode too. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="sol3-wa__qr" src={pairing.qr} alt={`QR code that opens WhatsApp with LINK ${pairing.code} ready to send`} width={132} height={132} />
        </div>
      ) : null}
      <span className="sol3-wa__note">
        Your messages are handled as described in our{" "}
        <a href="https://www.plexopages.com/privacy" target="_blank" rel="noopener noreferrer">
          Privacy Policy
        </a>
        .
      </span>
      {error ? <p className="sol3-wa__err" role="alert">{error}</p> : null}
    </div>
  );
}
