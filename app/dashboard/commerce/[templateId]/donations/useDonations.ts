"use client";

import { useState } from "react";
import type { DonationsOverview } from "@/lib/commerce/donations";
import { checkDraft, embedCode, type Campaign, type Draft } from "@/lib/commerce/donationForm";

/** The donations screen's data and calls (same routes as ever), shared by the hub and the old page. */
export function useDonations(templateId: string, initial: DonationsOverview) {
  const [data, setData] = useState(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const apiBase = `/api/v1/commerce/${templateId}/donations`;

  async function reload() {
    const res = await fetch(apiBase);
    if (res.ok) setData(await res.json());
  }
  async function save() {
    if (!draft) return;
    setError(null);
    const body = checkDraft(draft);
    if (typeof body === "string") return setError(body);
    setSaving(true);
    try {
      const res = await fetch(draft.id ? `${apiBase}/${draft.id}` : apiBase, { method: draft.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error ?? "We couldn't save that donation form. Please try again.");
      setDraft(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't save that donation form. Please try again.");
    } finally {
      setSaving(false);
    }
  }
  async function toggleActive(c: Campaign) {
    setBusy(c.id);
    await fetch(`${apiBase}/${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !c.active }) });
    await reload();
    setBusy(null);
  }
  async function adoptDonors(c: Campaign) {
    setBusy(`adopt-${c.id}`);
    setNotice(null);
    const res = await fetch(`${apiBase}/adopt-monthly-donors`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId: c.id }) });
    const body = await res.json();
    setNotice(res.ok ? (body.adopted > 0 ? `${body.adopted} monthly donor${body.adopted > 1 ? "s" : ""} brought over. Their gifts keep billing as before, and every charge now shows up here.` : "No new monthly donors found on your connected payment account.") : body.error ?? "We couldn't check for monthly donors.");
    await reload();
    setBusy(null);
  }
  async function stopGift(id: string) {
    setBusy(id);
    const res = await fetch(`${apiBase}/subscriptions/${id}`, { method: "DELETE" });
    if (!res.ok) setNotice((await res.json()).error ?? "We couldn't stop that gift.");
    await reload();
    setBusy(null);
  }
  function copyEmbed(id: string) {
    void navigator.clipboard.writeText(embedCode(id));
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }
  return { data, draft, setDraft, saving, error, setError, notice, copied, busy, save, toggleActive, adoptDonors, stopGift, copyEmbed };
}
