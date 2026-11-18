"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, ImagePlus, RefreshCw } from "lucide-react";
import { strataBrandBibleUrl } from "@/lib/strata/appUrl";
import { Button, Card, CardHeader, Input, Modal, Skeleton, Textarea, useToast } from "../ui";
import { StrataBrandPicker, type StrataPickerClient } from "../brand/StrataBrandPicker";
import { createStrataAdapter } from "@/app/dashboard/apps/_components/strataAdapter";
import { brandHeadline, type BrandState } from "@/app/dashboard/templates/[id]/detail/SiteBrandPanel";
import { LookCard } from "./LookCard";
import type { SiteBrand } from "@/lib/dashboardV3/brandLook";
import { TabBar } from "./HubFrame";
import { errMsg, hubApi } from "./hubApi";

type Meta = { htmlTitle: string; favicon: string; metaDescription: string; ogImageUrl: string };
export type HubBrand = { name?: string; colors?: string[]; primaryColor?: string; logoUrl?: string } | null;

/** The Strata brand of one site: what it is, whether it stays up to date, and every switch for it, in plain words. */
export function StrataBrand({ siteId, siteName, isRaw, client, preview, previewState }: { siteId: string; siteName: string; isRaw: boolean; client?: StrataPickerClient; preview?: boolean; previewState?: BrandState }) {
  const { show } = useToast();
  const [available, setAvailable] = useState<boolean | null>(previewState ? true : null);
  const [state, setState] = useState<BrandState | null>(previewState ?? null);
  const [picking, setPicking] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const path = `/api/v1/sites/${encodeURIComponent(siteId)}/brand`;
  const call = useCallback((init?: { method: string; json?: unknown }) => hubApi<BrandState>(path, init, "We couldn't update your brand. Please try again."), [path]);

  useEffect(() => {
    if (previewState) return;
    let off = false;
    (client ?? createStrataAdapter())
      .available()
      .then(async (on) => {
        if (off) return;
        setAvailable(on);
        if (on) setState(await call());
      })
      .catch((e) => !off && (setAvailable(true), setError(errMsg(e, "We couldn't load your brand."))));
    return () => {
      off = true;
    };
  }, [client, call, previewState]);

  async function run(label: string, fn: () => Promise<BrandState | void>, done?: string) {
    setBusy(label);
    setError(null);
    try {
      const next = await fn();
      if (next) setState(next);
      if (done) show({ title: done, tone: "success" });
    } catch (e) {
      setError(errMsg(e, "Something went wrong. Please try again."));
    } finally {
      setBusy(null);
    }
  }

  if (available === false) return null;
  if (!state) return error ? <p className="plx-field__error" role="alert">{error}</p> : <Card><Skeleton height={20} width="40%" style={{ marginBottom: 14 }} /><Skeleton height={64} /></Card>;

  const resolved = state.resolved ?? null;
  const canCreate = !!resolved?.colours.some((c) => c.role === "primary");
  const onDone = (next: Record<string, unknown>, message: string) => {
    setState(next as unknown as BrandState);
    setPicking(false);
    show({ title: message, tone: "success" });
  };

  const sendNow = () => run("send", async () => {
    const out = await call({ method: "POST", json: { sendToStrata: true } });
    const sent = (out as unknown as { sent?: { message?: string } }).sent;
    if (sent?.message) show({ title: sent.message, tone: "success" });
    return out;
  });

  if (!state.linked) {
    return (
      <>
        <Card data-tour="hub-brand-pending">
          <CardHeader title="Your brand is saved on Plexo for now" description="Your colours and logo are kept in Strata, the one place your brand lives. We're sending them there; this finishes by itself, or you can do it now." action={<Button size="sm" loading={busy === "send"} onClick={sendNow}>Send to Strata</Button>} />
          {error ? <p className="plx-field__error" role="alert">{error}</p> : null}
        </Card>
      <Card tone="elevated" data-tour="hub-brand-connect">
        <CardHeader title="Use a brand you already have in Strata" description="Keep your colours, fonts and logo in one place, Strata. Pick a brand, or make one from the colours you're using now, and every page on this site matches and stays up to date. SOL uses it too, without being asked." />
        <StrataBrandPicker mode="site" siteId={siteId} siteName={siteName} client={client} canCreate={canCreate} preview={preview} onDone={onDone} />
      </Card>
      </>
    );
  }

  const headline = brandHeadline(state);
  const tone = headline.tone === "bad" ? "inlinemsg--bad" : headline.tone === "warn" ? "inlinemsg--warn" : "";
  return (
    <>
    <Card data-tour="hub-brand-strata">
      <CardHeader
        title={state.projectName ?? "Your brand"}
        description="From Strata. It decides your colours and fonts on every page, and SOL uses it on everything it makes. The colours below are kept as a backup."
        action={<Button variant="secondary" size="sm" onClick={() => setPicking(true)}>Change brand</Button>}
      />
      <div className="plx-brandlook">
        {resolved?.colours.length ? (
          <div className="plx-swatches">
            {resolved.colours.map((c) => (
              <span key={c.role + c.value} className="plx-swatch" title={c.value}>
                <i style={{ background: c.value }} />
                {c.label}
              </span>
            ))}
          </div>
        ) : resolved === null ? <Skeleton height={48} width="70%" /> : null}
        {resolved?.fonts.heading || resolved?.fonts.body ? (
          <div className="plx-fonts">
            {[["Headings", resolved.fonts.heading], ["Text", resolved.fonts.body]].filter(([, f]) => f).map(([label, family]) => (
              <div key={label} className="plx-font">
                <span className="plx-small">{label}</span>
                <b style={{ fontFamily: `"${family}", system-ui, sans-serif` }}>{family}</b>
              </div>
            ))}
          </div>
        ) : null}
        {resolved?.logoUrl ? <img src={resolved.logoUrl} alt="Your logo" style={{ maxHeight: 48, maxWidth: 200, objectFit: "contain", alignSelf: "flex-start" }} /> : null}
      </div>
      <div className={`plx-inlinemsg ${tone ? "plx-" + tone : ""}`} role="status">{headline.text}</div>
      {/* The brand lives in Strata: say so, show whether the latest change has arrived, and open it there in one click. */}
      <div className="plx-inlinemsg" role="status" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
        <span>{state.sendPending ? "Your latest change is saved here and is on its way to Strata. This finishes by itself." : `Your brand is saved in Strata${state.projectName ? ` as “${state.projectName}”` : ""}.`}</span>
        <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
          {state.sendPending ? <Button size="sm" variant="secondary" loading={busy === "send"} onClick={sendNow}>Send to Strata now</Button> : null}
          {state.projectId ? <a className="plx-btn plx-btn--secondary plx-btn--sm" href={strataBrandBibleUrl(state.projectId)} target="_blank" rel="noreferrer">View in Strata <ExternalLink size={14} aria-hidden /></a> : null}
        </span>
      </div>

      <div className="plx-settings">
        <label className="plx-toggle">
          <span>
            <b>Keep in sync with Strata</b>
            <span className="plx-small" style={{ display: "block" }}>
              {state.autoSync ? "Changes you publish in Strata appear on your site within a couple of minutes." : "Your site keeps its current look until you turn this back on."}
            </span>
          </span>
          <input type="checkbox" className="plx-switch" checked={state.autoSync} disabled={busy !== null || state.status !== "active"} aria-label="Keep in sync with Strata" onChange={(e) => run("sync", () => call({ method: "PATCH", json: { autoSync: e.target.checked } }))} />
        </label>
        {isRaw ? (
          <div className="plx-toggle">
            <span>
              <b>Use my brand on this site</b>
              <span className="plx-small" style={{ display: "block" }}>
                {state.canUseOnSite ? "Your page's main colours and fonts are swapped for your brand's. Turn it off to see the original look again. Nothing is lost." : "Your page was built outside Plexo. We can match its main colours and fonts to your brand."}
              </span>
            </span>
            {state.canUseOnSite ? (
              <input type="checkbox" className="plx-switch" checked={state.useOnSite} disabled={busy !== null} aria-label="Use my brand on this site" onChange={(e) => run("use", () => call({ method: "PATCH", json: { useOnSite: e.target.checked } }))} />
            ) : (
              <Button variant="secondary" loading={busy === "apply"} onClick={() => run("apply", () => call({ method: "PATCH", json: { applyBrand: true } }), "Your brand is matched")}>Use my brand</Button>
            )}
          </div>
        ) : null}
        {state.serverApp ? (
          <label className="plx-toggle">
            <span>
              <b>Add my brand to my app</b>
              <span className="plx-small" style={{ display: "block" }}>
                {state.brandInApp
                  ? "Your brand's colours and fonts are available to every page of your app, with nothing to add to your code. Turn it off any time and your pages go back to exactly what your code produces."
                  : "Plexo can make your brand's colours and fonts available to your app's pages for you. Nothing changes until you turn this on."}
              </span>
            </span>
            <input type="checkbox" className="plx-switch" checked={state.brandInApp === true} disabled={busy !== null} aria-label="Add my brand to my app" onChange={(e) => run("app", () => call({ method: "PATCH", json: { brandInApp: e.target.checked } }))} />
          </label>
        ) : null}
      </div>

      <div className="plx-hactionrow">
        {state.status === "needs-reconnect" ? (
          <Button onClick={() => setPicking(true)}>Link it again</Button>
        ) : (
          <Button variant="secondary" leftIcon={<RefreshCw size={16} aria-hidden />} loading={busy === "now"} onClick={() => run("now", () => call({ method: "PATCH", json: { syncNow: true } }))}>Check Strata now</Button>
        )}
        <Button variant="ghost" style={{ color: "var(--plx-danger)" }} onClick={() => setConfirmStop(true)}>Stop using this brand</Button>
      </div>
      {error ? <p className="plx-field__error" role="alert" style={{ marginTop: 12 }}>{error}</p> : null}
      <Modal open={picking} onClose={() => setPicking(false)} title="Change brand" description="Pick the Strata brand with your colours, fonts and logo.">
        <StrataBrandPicker mode="site" siteId={siteId} siteName={siteName} client={client} currentProjectId={state.projectId} canCreate={false} createHint="This website already uses a Strata brand. Stop using it first to make a new one." preview={preview} onDone={onDone} onCancel={() => setPicking(false)} />
      </Modal>
      <Modal
        open={confirmStop}
        onClose={() => setConfirmStop(false)}
        title="Stop using this brand?"
        description="Your pages go back to the colours and fonts they were built with. You can connect it again any time."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmStop(false)}>Keep it</Button>
            <Button variant="danger" loading={busy === "unlink"} onClick={() => run("unlink", () => call({ method: "DELETE" }), "Brand removed").then(() => setConfirmStop(false))}>Stop using it</Button>
          </>
        }
      >
        <span />
      </Modal>
    </Card>
    <BrandComponents components={resolved?.components ?? []} projectId={state.projectId} />
    </>
  );
}

/** The brand's ready-made components (buttons, cards...), kept in Strata. SOL and any AI helper use them before inventing their own. */
export function BrandComponents({ components, projectId }: { components: Array<{ name: string; variants: string[]; slots: Array<{ role: string }> }>; projectId: string | null }) {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return (
    <Card data-tour="hub-brand-components">
      <CardHeader
        title="Ready-made pieces"
        description={components.length ? "Buttons, cards and other pieces from your brand. SOL and your AI helpers use these first, so everything you build matches." : "Your brand has no ready-made pieces yet. When SOL or your AI helper builds something you want to reuse, like a button or a card, they can save it here for you."}
        action={projectId ? <a className="plx-btn plx-btn--secondary plx-btn--sm" href={strataBrandBibleUrl(projectId)} target="_blank" rel="noreferrer">View in Strata <ExternalLink size={14} aria-hidden /></a> : undefined}
      />
      {components.length ? (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
          {components.map((c) => (
            <li key={c.name} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", justifyContent: "space-between" }}>
              <b>{cap(c.name)}</b>
              <span className="plx-small">
                {c.variants.length ? `Looks: ${c.variants.join(", ")}` : "One look"}
                {c.slots.length ? ` · You fill in: ${c.slots.map((s) => s.role).join(", ")}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

/** Colours and logo, plus the little things that make a site look like yours in a browser tab and when shared. */
export function BrandTab({ siteId, siteName, brand, defaults = null, sourceType = "BUILDER", strataClient, strataPreviewState }: { siteId: string; siteName: string; brand: SiteBrand | null; defaults?: HubBrand; experience?: string; sourceType?: string; /** Dev preview only. */ strataClient?: StrataPickerClient; strataPreviewState?: BrandState }) {
  const { show } = useToast();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    hubApi<Meta>(`/api/v1/templates/${siteId}/site-meta`).then(setMeta, (e) => setError(errMsg(e, "We couldn't load these details.")));
  }, [siteId]);

  async function icon(file: File) {
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const { url } = await hubApi<{ url: string }>("/api/v1/media/upload", { method: "POST", body }, "We couldn't upload that picture. Try a smaller one.");
      setMeta((m) => (m ? { ...m, favicon: url } : m));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setUploading(false);
    }
  }
  async function save() {
    if (!meta) return;
    setBusy(true);
    setError(null);
    try {
      await hubApi(`/api/v1/templates/${siteId}/site-meta`, { method: "PUT", json: meta }, "We couldn't save that. Please try again.");
      show({ title: "Saved", tone: "success" });
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <TabBar title="Your look" sub="Colours, logo and the little details that make it yours." />
      <div className="plx-hub__split" data-tour="hub-brand">
        <div className="plx-hub__col">
          <StrataBrand siteId={siteId} siteName={siteName} isRaw={sourceType === "RAW_UPLOAD"} client={strataClient} preview={!!strataClient} previewState={strataPreviewState} />
          <LookCard siteId={siteId} siteName={siteName} own={brand} defaults={defaults} sourceType={sourceType} />
        </div>
        <Card>
          <CardHeader title="Browser tab and sharing" description="What people see in their browser tab and when your link is shared." />
          {meta ? (
            <div className="plx-form">
              <Input label="Title in the browser tab" value={meta.htmlTitle ?? ""} onChange={(e) => setMeta({ ...meta, htmlTitle: e.target.value })} placeholder={siteName} />
              <Textarea label="One sentence about your site" help="Shown when your link is shared or found online." value={meta.metaDescription ?? ""} onChange={(e) => setMeta({ ...meta, metaDescription: e.target.value })} style={{ minHeight: 88 }} />
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span className="plx-hrow__thumb" style={{ width: 48, height: 48 }}>{meta.favicon ? <img src={meta.favicon} alt="" /> : <ImagePlus size={20} aria-hidden />}</span>
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && icon(e.target.files[0])} />
                <Button variant="secondary" loading={uploading} onClick={() => fileRef.current?.click()}>{meta.favicon ? "Change small icon" : "Add a small icon"}</Button>
              </div>
              {error ? <p className="plx-field__error" role="alert">{error}</p> : null}
              <div><Button loading={busy} onClick={save}>Save</Button></div>
            </div>
          ) : error ? <p className="plx-field__error" role="alert">{error}</p> : <div className="plx-form"><Skeleton height={48} /><Skeleton height={88} /></div>}
        </Card>
      </div>
    </>
  );
}
