"use client";

import Link from "next/link";
import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "../../ui";
import { layoutCandidateLine } from "@/lib/commerce/shopSettingsForm";

type Layout = { templateId: string; ready: boolean } | null;
type Candidate = { layoutTemplateId: string; layoutName: string; siteName: string; updatedAt: string };

/** The product page: edit it, make it, reuse another site's design, or turn it off. Same product-detail-layout calls as the old page. */
export function ProductPagePicker({ templateId, layout }: { templateId: string; layout: Layout }) {
  const router = useRouter();
  const api = `/api/v1/commerce/${templateId}/product-detail-layout`;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [picking, setPicking] = useState(false);

  async function call(init: RequestInit, fail: string): Promise<{ ok: boolean; data: Record<string, unknown> }> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(api, init);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data.error as string) ?? fail);
        return { ok: false, data };
      }
      return { ok: true, data };
    } catch {
      setError(fail);
      return { ok: false, data: {} };
    } finally {
      setBusy(false);
    }
  }
  async function make() {
    if ((await call({ method: "POST" }, "We couldn't make your product page. Please try again.")).ok) router.refresh();
  }
  async function turnOff() {
    if (!window.confirm("Turn off product pages? Links to your products will stop working until you turn them back on. Your design stays saved.")) return;
    if ((await call({ method: "DELETE" }, "We couldn't turn that off. Please try again.")).ok) router.refresh();
  }
  async function openPicker() {
    setPicking(true);
    if (candidates === null) {
      const r = await call({ method: "GET" }, "We couldn't look for other designs. Please try again.");
      setCandidates(r.ok ? ((r.data.candidates as Candidate[]) ?? []) : []);
    }
  }
  async function use(c: Candidate) {
    const r = await call({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceLayoutTemplateId: c.layoutTemplateId }) }, "We couldn't use that design. Please try again.");
    if (r.ok && typeof r.data.layoutTemplateId === "string") router.push(`/dashboard/templates/${r.data.layoutTemplateId}`);
  }

  return (
    <div className="plx-form">
      {layout ? (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <Link className="plx-btn plx-btn--secondary" href={`/dashboard/templates/${layout.templateId}`}><Pencil size={16} aria-hidden /> Change how it looks</Link>
          <Button variant="ghost" disabled={busy} onClick={turnOff}>Turn off</Button>
          {!layout.ready ? <span className="plx-small">A needed block was removed from the page, so products can&apos;t show. Open it and add it back.</span> : null}
        </div>
      ) : (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <Button loading={busy && !picking} onClick={make}>Make my product page now</Button>
          <Button variant="secondary" disabled={busy} onClick={openPicker}>Use a design from another site</Button>
          <span className="plx-small">It's also made for you when you save with your shop on.</span>
        </div>
      )}
      {error ? <GateOrError error={error}><p className="plx-field__error" role="alert">{error}</p></GateOrError> : null}
      {picking && !layout ? (
        candidates === null ? <p className="plx-small">Looking for your other designs…</p> : candidates.length === 0 ? (
          <p className="plx-small">You don&apos;t have another site with a product page yet, so we&apos;ll make a fresh one for you instead.</p>
        ) : (
          <ul className="plx-money__list" aria-label="Designs you can reuse">
            {candidates.map((c) => (
              <li key={c.layoutTemplateId} className="plx-money__row">
                <span className="plx-hrow__main"><span className="plx-hrow__title">{c.layoutName}</span><span className="plx-hrow__sub">{layoutCandidateLine(c.siteName, c.updatedAt)}</span></span>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => void use(c)}>Use this one</Button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
