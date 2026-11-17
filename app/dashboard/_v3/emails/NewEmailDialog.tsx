"use client";

import "./emails.css";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, Search } from "lucide-react";
import { Badge, Button, ButtonLink, Input, Modal, SegmentedControl, Skeleton } from "../ui";
import { errMsg, hubApi } from "../hub/hubApi";
import type { EmailUsage } from "@/lib/dashboardV3/emails";

export type ReadyMadeEmail = { id: string; name: string; category: string | null; priceCents: number };

/** Start a new email: blank, or from a ready-made design (emails only: the picker asks for EMAIL kind). */
export function NewEmailDialog({ open, onClose, usage, designs, preview }: { open: boolean; onClose: () => void; usage: EmailUsage; designs?: ReadyMadeEmail[]; preview?: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"blank" | "design">("blank");
  const [name, setName] = useState("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<ReadyMadeEmail[] | null>(designs ?? null);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || designs) return;
    let off = false;
    const t = window.setTimeout(() => {
      const p = new URLSearchParams({ kind: "EMAIL", sort: "popular", ...(q.trim() ? { q: q.trim() } : {}) });
      fetch(`/api/v1/marketplace/templates?${p}`)
        .then((r) => r.json())
        .then((d) => !off && setItems(((d.templates ?? []) as (ReadyMadeEmail & { kind?: string })[]).filter((x) => !x.kind || x.kind === "EMAIL")))
        .catch(() => !off && setItems([]));
    }, q ? 250 : 0);
    return () => {
      off = true;
      window.clearTimeout(t);
    };
  }, [open, q, designs]);

  const shown = designs ? designs.filter((d) => d.name.toLowerCase().includes(q.trim().toLowerCase())) : items;
  const chosen = shown?.find((d) => d.id === picked) ?? null;

  async function create() {
    setError(null);
    setBusy(true);
    try {
      if (preview) return onClose();
      if (mode === "blank") {
        if (!name.trim()) throw new Error("Give your email a name first, like “Welcome email”.");
        const r = await hubApi<{ template: { id: string } }>("/api/templates", { method: "POST", json: { name: name.trim(), kind: "EMAIL" } });
        router.push(`/dashboard/templates/${r.template.id}`);
      } else if (chosen) {
        if (chosen.priceCents > 0) return void router.push(`/dashboard/marketplace/${chosen.id}`);
        const r = await hubApi<{ template: { id: string } }>(`/api/v1/marketplace/templates/${chosen.id}/use`, { method: "POST" });
        router.push(`/dashboard/templates/${r.template.id}`);
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const footer = usage.atLimit ? (
    <>
      <Button variant="secondary" onClick={onClose}>Not now</Button>
      <ButtonLink href="/dashboard/settings/plan">See plans</ButtonLink>
    </>
  ) : (
    <>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button loading={busy} disabled={mode === "design" && !chosen} onClick={create}>{mode === "design" && chosen && chosen.priceCents > 0 ? "See this design" : "Create email"}</Button>
    </>
  );

  return (
    <Modal open={open} onClose={onClose} width={720} title="New email" description={usage.atLimit ? undefined : "Start from nothing, or from a design that is already laid out."} footer={footer}>
      {usage.atLimit ? (
        <div className="plx-inlinemsg plx-inlinemsg--warn">You have used all {usage.limit} email{usage.limit === 1 ? "" : "s"} your plan includes. Delete one you don&apos;t need, or move to a bigger plan to make more.</div>
      ) : (
        <div className="plx-newem">
          <SegmentedControl label="How to start" value={mode} onChange={setMode} options={[{ value: "blank", label: "Blank email" }, { value: "design", label: "Ready-made design" }]} />
          {mode === "blank" ? (
            <Input label="What is this email for?" value={name} onChange={(e) => setName(e.target.value)} placeholder="Welcome email" onKeyDown={(e) => e.key === "Enter" && create()} help="Only you see this name." />
          ) : (
            <>
              <div className="plx-search" style={{ maxWidth: "none" }}>
                <Search size={18} aria-hidden />
                <Input hideLabel label="Search designs" placeholder="Search email designs" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              {shown === null ? (
                <div className="plx-picker">{[0, 1, 2].map((i) => <Skeleton key={i} style={{ height: 140, borderRadius: 16 }} />)}</div>
              ) : shown.length === 0 ? (
                <p className="plx-small">No email designs match that.</p>
              ) : (
                <div className="plx-picker" role="radiogroup" aria-label="Email designs" style={{ maxHeight: 340, overflowY: "auto", paddingRight: 2 }}>
                  {shown.map((d) => (
                    <button key={d.id} type="button" role="radio" aria-checked={picked === d.id} className="plx-pick" onClick={() => setPicked(d.id)}>
                      <span className="plx-pick__art"><Mail size={36} aria-hidden /></span>
                      <span className="plx-pick__t">
                        <b>{d.name}</b>
                        <span>{d.category ?? "Email"}</span>
                        {d.priceCents > 0 ? <Badge tone="brand">Paid</Badge> : <Badge tone="success">Free</Badge>}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {error ? <div className="plx-inlinemsg plx-inlinemsg--bad" role="alert">{error}</div> : null}
        </div>
      )}
    </Modal>
  );
}
