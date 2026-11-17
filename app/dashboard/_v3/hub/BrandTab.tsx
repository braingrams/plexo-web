"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Link2, MessagesSquare, RefreshCw } from "lucide-react";
import { Button, ButtonLink, Card, CardHeader, Input, Modal, Select, Skeleton, Textarea, useToast } from "../ui";
import { createStrataAdapter } from "@/app/dashboard/apps/_components/strataAdapter";
import { brandHeadline, type BrandState, type StrataProject } from "@/app/dashboard/templates/[id]/detail/SiteBrandPanel";
import { brandLook, type BrandLook } from "@/lib/dashboardV3/hubBrand";
import { LookCard } from "./LookCard";
import type { SiteBrand } from "@/lib/dashboardV3/brandLook";
import { TabBar } from "./HubFrame";
import { errMsg, hubApi } from "./hubApi";

type Meta = { htmlTitle: string; favicon: string; metaDescription: string; ogImageUrl: string };
export type HubBrand = { name?: string; colors?: string[]; primaryColor?: string; logoUrl?: string } | null;

/** The Strata brand of one site: what it is, whether it stays up to date, and every switch for it, in plain words. */
function StrataBrand({ siteId, isRaw }: { siteId: string; isRaw: boolean }) {
  const { show } = useToast();
  const strata = useMemo(() => createStrataAdapter(), []);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [state, setState] = useState<BrandState | null>(null);
  const [look, setLook] = useState<BrandLook | null>(null);
  const [connected, setConnected] = useState(false);
  const [projects, setProjects] = useState<StrataProject[] | null>(null);
  const [choice, setChoice] = useState("");
  const [picking, setPicking] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const path = `/api/v1/sites/${encodeURIComponent(siteId)}/brand`;
  const call = useCallback((init?: { method: string; json?: unknown }) => hubApi<BrandState>(path, init, "We couldn't update your brand. Please try again."), [path]);

  const loadLook = useCallback((id: string | null) => {
    if (!id) return setLook(null);
    fetch(`/api/public/brand/${id}.css`).then((r) => (r.ok ? r.text() : "")).then((css) => setLook(brandLook(css)), () => setLook(null));
  }, []);

  useEffect(() => {
    let off = false;
    strata
      .available()
      .then(async (on) => {
        if (off) return;
        setAvailable(on);
        if (!on) return;
        const [s, st] = await Promise.all([call(), strata.status().catch(() => ({ connected: false }))]);
        if (off) return;
        setState(s);
        setConnected(st.connected);
        if (s.linked) loadLook(siteId);
      })
      .catch((e) => !off && (setAvailable(true), setError(errMsg(e, "We couldn't load your brand."))));
    return () => {
      off = true;
    };
  }, [strata, call, loadLook, siteId]);

  async function run(label: string, fn: () => Promise<BrandState | void>, done?: string) {
    setBusy(label);
    setError(null);
    try {
      const next = await fn();
      if (next) {
        setState(next);
        if (next.linked) loadLook(siteId);
        else setLook(null);
      }
      if (done) show({ title: done, tone: "success" });
    } catch (e) {
      setError(errMsg(e, "Something went wrong. Please try again."));
    } finally {
      setBusy(null);
    }
  }

  const startPicking = () =>
    run("pick", async () => {
      if (!connected) {
        const s = await strata.connect();
        setConnected(s.connected);
        if (!s.connected) return;
      }
      const list = await strata.listProjects();
      setProjects(list);
      setChoice(list.find((p) => p.id === state?.projectId)?.id ?? list[0]?.id ?? "");
      setPicking(true);
    });
  const link = () =>
    run(
      "link",
      async () => {
        const project = projects?.find((p) => p.id === choice);
        if (!project) throw new Error("Choose a brand first.");
        const next = await call({ method: "POST", json: { projectId: project.id, projectName: project.name, autoSync: true } });
        setPicking(false);
        return next;
      },
      "Your brand is on your site",
    );

  if (available === false) return null;
  if (!state) return error ? <p className="plx-field__error" role="alert">{error}</p> : <Card><Skeleton height={20} width="40%" style={{ marginBottom: 14 }} /><Skeleton height={64} /></Card>;

  const headline = state.linked ? brandHeadline(state) : null;
  const picker = (
    <Modal
      open={picking}
      onClose={() => setPicking(false)}
      title={state.linked ? "Change brand" : "Choose your brand"}
      description="Pick the Strata brand with your colours, fonts and buttons."
      footer={
        projects && projects.length ? (
          <>
            <Button variant="secondary" onClick={() => setPicking(false)}>Cancel</Button>
            <Button loading={busy === "link"} disabled={!choice} onClick={link}>Use this brand</Button>
          </>
        ) : (
          <Button variant="secondary" onClick={() => setPicking(false)}>Close</Button>
        )
      }
    >
      {projects && projects.length ? (
        <Select label="Brand" value={choice} onChange={(e) => setChoice(e.target.value)} options={projects.map((p) => ({ value: p.id, label: p.name }))} />
      ) : (
        <p className="plx-body">You don&apos;t have a brand in Strata yet. Create one there, then come back and choose it.</p>
      )}
      {error ? <p className="plx-field__error" role="alert" style={{ marginTop: 12 }}>{error}</p> : null}
    </Modal>
  );

  if (!state.linked) {
    return (
      <Card tone="elevated" data-tour="hub-brand-connect">
        <CardHeader title="Connect your brand" description="Keep your colours and fonts in one place, Strata. Connect it and every page on this site matches, and stays up to date when you change it." />
        <Button leftIcon={<Link2 size={18} aria-hidden />} loading={busy === "pick"} onClick={startPicking}>
          {connected ? "Choose my brand" : "Connect my brand"}
        </Button>
        {!connected ? <p className="plx-small" style={{ marginTop: 10 }}>You&apos;ll sign in with your Charisol account.</p> : null}
        {error && !picking ? <p className="plx-field__error" role="alert" style={{ marginTop: 12 }}>{error}</p> : null}
        {picker}
      </Card>
    );
  }

  const tone = headline?.tone === "bad" ? "inlinemsg--bad" : headline?.tone === "warn" ? "inlinemsg--warn" : "";
  return (
    <Card data-tour="hub-brand-strata">
      <CardHeader
        title={state.projectName ?? "Your brand"}
        description="From Strata. It's used on every page of this site."
        action={<Button variant="secondary" size="sm" loading={busy === "pick"} onClick={startPicking}>Change brand</Button>}
      />
      <div className="plx-brandlook">
        {look?.colors.length ? (
          <div className="plx-swatches">
            {look.colors.map((c) => (
              <span key={c.label} className="plx-swatch" title={c.value}>
                <i style={{ background: c.value }} />
                {c.label}
              </span>
            ))}
          </div>
        ) : look === null ? <Skeleton height={48} width="70%" /> : null}
        {look?.fonts.length ? (
          <div className="plx-fonts">
            {look.fonts.map((f) => (
              <div key={f.label} className="plx-font">
                <span className="plx-small">{f.label}</span>
                <b style={{ fontFamily: `"${f.family}", system-ui, sans-serif` }}>{f.family}</b>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {headline ? <div className={`plx-inlinemsg ${tone ? "plx-" + tone : ""}`} role="status">{headline.text}</div> : null}

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
      </div>

      <div className="plx-actionrow">
        {state.status === "needs-reconnect" ? (
          <Button loading={busy === "pick"} onClick={startPicking}>Link it again</Button>
        ) : (
          <Button variant="secondary" leftIcon={<RefreshCw size={16} aria-hidden />} loading={busy === "now"} onClick={() => run("now", () => call({ method: "PATCH", json: { syncNow: true } }))}>Check Strata now</Button>
        )}
        <Button variant="ghost" style={{ color: "var(--plx-danger)" }} onClick={() => setConfirmStop(true)}>Stop using this brand</Button>
      </div>
      {error && !picking ? <p className="plx-field__error" role="alert" style={{ marginTop: 12 }}>{error}</p> : null}
      {picker}
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
  );
}

/** Colours and logo, plus the little things that make a site look like yours in a browser tab and when shared. */
export function BrandTab({ siteId, siteName, brand, defaults = null, sourceType = "BUILDER" }: { siteId: string; siteName: string; brand: SiteBrand | null; defaults?: HubBrand; experience?: string; sourceType?: string }) {
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
          <StrataBrand siteId={siteId} isRaw={sourceType === "RAW_UPLOAD"} />
          <LookCard siteId={siteId} siteName={siteName} own={brand} defaults={defaults} sourceType={sourceType} />
        </div>
        <Card>
          <CardHeader title="Browser tab and sharing" description="What people see in their browser tab and when your link is shared." />
          {meta ? (
            <div className="plx-form">
              <Input label="Title in the browser tab" value={meta.htmlTitle ?? ""} onChange={(e) => setMeta({ ...meta, htmlTitle: e.target.value })} placeholder={siteName} />
              <Textarea label="One sentence about your site" help="Shown when your link is shared or found online." value={meta.metaDescription ?? ""} onChange={(e) => setMeta({ ...meta, metaDescription: e.target.value })} style={{ minHeight: 88 }} />
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span className="plx-row__thumb" style={{ width: 48, height: 48 }}>{meta.favicon ? <img src={meta.favicon} alt="" /> : <ImagePlus size={20} aria-hidden />}</span>
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
