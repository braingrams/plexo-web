"use client";

/**
 * DesignPicker: a browser of REAL marketplace web page designs for one goal, best fit first. Reusable by any
 * "create a website" flow (onboarding's "See all designs"; the dashboard's "Start new" designs step).
 *
 * Props
 *  - goal      what the owner is making (SolBuildGoal: store, business-site, blog, course, landing, link-in-bio, explore). Decides the ranking.
 *  - profile   the owner's answers (SolBuildProfile). Sent to the server only to rank by what they do. Optional.
 *  - onUse     called with the chosen design once it is theirs to use: free, already bought, or just paid for.
 *              Return a promise: the card shows "Making your site..." until it settles. Throw/reject to show the message.
 *  - returnTo  where Stripe brings someone back after paying in the card modal. Only "/welcome/setup", "/welcome/setup?new=1" or
 *              "/dashboard/sites/new" are accepted by the server (the design id is added as ?paidDesign=). Default: the marketplace page.
 *  - busy      true while the caller is making the site, to disable the other cards.
 *  - mock      development only: made-up designs, nothing is bought or created.
 *  - endpoint  the list API (default "/api/onboarding/market-designs").
 *
 * How "use" works: free or owned designs go straight to onUse; a free design is first added to the owner's designs
 * (purchase route, no charge); a paid design opens the card payment in a modal and only reaches onUse after the
 * payment is recorded (the caller then makes the site from it with the marketplace "use" path, which re-checks ownership).
 * Prices are US dollars, as the marketplace charges them.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { Eye, Layers, Search } from "lucide-react";
import type { SolBuildProfile } from "@/lib/ai/solBuildContext";
import { getStripePromise } from "@/lib/stripeClientPromise";
import { priceBadge, useLabel } from "@/lib/onboarding/marketDesigns";
import { Badge, Button, EmptyState, Input, Modal, Notice, OptimisticLoader, SegmentedControl, Skeleton } from "../ui";
import { DesignPreview } from "./DesignPreview";
import "./designs.css";

export type PickerDesign = { id: string; name: string; category: string | null; description: string | null; priceCents: number; owned: boolean; bestFit: boolean; html: string | null };
type Price = "any" | "free" | "paid";

export type DesignPickerProps = {
  goal: SolBuildProfile["goal"] | string | undefined;
  profile?: SolBuildProfile;
  onUse: (design: PickerDesign) => Promise<void> | void;
  returnTo?: string;
  busy?: boolean;
  mock?: boolean;
  endpoint?: string;
};

export function DesignPicker({ goal, profile, onUse, returnTo, busy, mock, endpoint = "/api/onboarding/market-designs" }: DesignPickerProps) {
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [price, setPrice] = useState<Price>("any");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ designs: PickerDesign[]; total: number; pageCount: number; categories: string[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [working, setWorking] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const seq = useRef(0);
  const profileKey = JSON.stringify({ ...(profile ?? {}), goal });

  useEffect(() => {
    const mine = ++seq.current;
    setLoading(true);
    setError("");
    fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile: JSON.parse(profileKey), q: applied, price: price === "any" ? undefined : price, category: category || undefined, page, mock }) })
      .then(async (res) => {
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof j?.error === "string" ? j.error : "We could not load the designs. Please try again.");
        if (mine === seq.current) setData(j);
      })
      .catch((e) => { if (mine === seq.current) setError(e instanceof Error ? e.message : "We could not load the designs. Please try again."); })
      .finally(() => { if (mine === seq.current) setLoading(false); });
  }, [endpoint, profileKey, applied, price, category, page, mock]);

  const finish = useCallback(async (d: PickerDesign) => {
    setWorking(d.id);
    setError("");
    try { await onUse(d); } catch (e) { setError(e instanceof Error && e.message ? e.message : "We could not make your site just now. Please try again."); }
    setWorking(null);
  }, [onUse]);

  const choose = useCallback(async (d: PickerDesign) => {
    setError("");
    if (mock || d.owned) return finish(d);
    setWorking(d.id);
    try {
      const res = await fetch(`/api/v1/marketplace/templates/${d.id}/purchase`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ returnTo }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof j?.error === "string" ? j.error : d.priceCents > 0 ? "We could not start the payment. Please try again." : "We could not add this design. Please try again.");
      if (j.clientSecret) { setSecret(j.clientSecret); setWorking(null); return; }
      await finish(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "We could not add this design. Please try again.");
      setWorking(null);
    }
  }, [finish, mock, returnTo]);

  const designs = data?.designs ?? [];
  const nothing = !loading && !error && designs.length === 0;
  const filtered = !!applied || price !== "any" || !!category;
  const reset = () => { setQ(""); setApplied(""); setPrice("any"); setCategory(""); setPage(1); };

  return (
    <div className="plx-dz plx-dzpick" data-busy={loading || undefined}>
      <div className="plx-dzbar">
        <div className="plx-dzbar__row" style={{ alignItems: "center" }}>
          <form className="plx-dzbar__search" role="search" onSubmit={(e) => { e.preventDefault(); setApplied(q); setPage(1); }}>
            <Search size={18} aria-hidden />
            <Input label="Search designs" hideLabel type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search, like “restaurant” or “portfolio”" />
          </form>
          <SegmentedControl label="Price" value={price} onChange={(v) => { setPrice(v); setPage(1); }} options={[{ value: "any", label: "All" }, { value: "free", label: "Free" }, { value: "paid", label: "Paid" }]} />
          <span className="plx-dzbar__count" aria-live="polite">{data ? `${data.total} ${data.total === 1 ? "design" : "designs"}` : ""}</span>
        </div>
        {data && data.categories.length > 0 ? (
          <div className="plx-dzchips" role="group" aria-label="Kind of site">
            <button type="button" className="plx-dzchip" aria-pressed={!category} onClick={() => { setCategory(""); setPage(1); }}>Best for you</button>
            {data.categories.map((c) => <button key={c} type="button" className="plx-dzchip" aria-pressed={category === c} onClick={() => { setCategory(category === c ? "" : c); setPage(1); }}>{c}</button>)}
          </div>
        ) : null}
      </div>

      {error ? <Notice kind="error" title="That did not work">{error}</Notice> : null}

      {nothing ? (
        <EmptyState title="No designs match yet" body={filtered ? "Try fewer filters or a different word." : "New designs are added all the time. Check back soon, or pick one of the designs above."} action={filtered ? <Button onClick={reset}>Show all designs</Button> : undefined} />
      ) : loading && !data ? (
        <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
          <OptimisticLoader steps={["Finding designs for your site…", "Matching layouts, fonts, and color styles…"]} subtitle="Loading design library" />
        </div>
      ) : (
        <ul className="plx-dzgrid" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {designs.map((d) => (
            <li key={d.id} className="plx-dzcard">
              <button type="button" className="plx-dzcard__thumb" aria-label={`Preview ${d.name}`} onClick={() => setPreviewId(d.id)} style={{ border: 0, padding: 0, cursor: "pointer", width: "100%" }}>
                {d.html ? <iframe title={`Picture of ${d.name}`} srcDoc={d.html} sandbox="" tabIndex={-1} loading="lazy" className="plx-dzcard__frame" /> : <span className="plx-dzcard__ph"><Layers size={34} aria-hidden /></span>}
                <span className="plx-dzcard__price"><Badge tone={d.priceCents <= 0 ? "success" : "neutral"}>{priceBadge(d.priceCents, d.owned).label}</Badge></span>
              </button>
              <div className="plx-dzcard__body">
                <div style={{ minWidth: 0 }}>
                  <h3 className="plx-dzcard__name">{d.name}</h3>
                  <p className="plx-dzcard__meta">{d.bestFit ? "Good fit for you" : "Web page"}{d.category ? ` · ${d.category}` : ""}</p>
                </div>
                <div className="plx-dzpick__acts">
                  <Button variant="secondary" size="sm" leftIcon={<Eye size={16} aria-hidden />} onClick={() => setPreviewId(d.id)} aria-label={`Preview ${d.name}`}>Preview</Button>
                  <Button size="sm" disabled={!!busy || (!!working && working !== d.id)} loading={working === d.id} loadingLabel={d.priceCents > 0 && !d.owned ? "Opening payment" : "Making your site"} onClick={() => choose(d)}>{useLabel(d.priceCents, d.owned)}</Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {data && data.pageCount > 1 ? (
        <nav className="plx-dzpager" aria-label="More designs">
          <span>Page {data.total ? page : 1} of {data.pageCount}</span>
          <div>
            {page > 1 ? <Button variant="secondary" onClick={() => setPage(page - 1)}>Previous</Button> : null}
            {page < data.pageCount ? <Button variant="secondary" onClick={() => setPage(page + 1)}>Next</Button> : null}
          </div>
        </nav>
      ) : null}

      <DesignPreview
        designId={previewId}
        onClose={() => setPreviewId(null)}
        onUse={(id) => { const d = designs.find((x) => x.id === id); if (d) void choose(d); }}
        useLabel={(() => { const d = designs.find((x) => x.id === previewId); return d ? useLabel(d.priceCents, d.owned) : "Use this design"; })()}
      />
      <Modal open={secret !== null} onClose={() => setSecret(null)} title="Pay for this design" description="Once it is paid, your site is made from it." width={520}>
        {secret ? (
          <div className="plx-dzcheckout">
            <EmbeddedCheckoutProvider stripe={getStripePromise()} options={{ clientSecret: secret }}>
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
