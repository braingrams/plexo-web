"use client";

import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ExternalLink, ImagePlus, RefreshCw } from "lucide-react";
import { strataBrandBibleUrl } from "@/lib/strata/appUrl";
import { Button, Card, CardHeader, Input, Modal, Skeleton, Textarea, useToast } from "../ui";
import { StrataBrandPicker, type StrataPickerClient } from "../brand/StrataBrandPicker";
import { createStrataAdapter } from "@/app/dashboard/apps/_components/strataAdapter";
import { brandHeadline, type BrandState } from "@/app/dashboard/templates/[id]/detail/SiteBrandPanel";
import { BrandDefinition } from "./BrandDefinition";
import { BrandHelp } from "./BrandHelp";
import { BrandWords } from "./BrandWords";
import { BrandSummary } from "./BrandSummary";
import { suggestedMetaDescription, type BrandVoice } from "@/lib/brand/brandVoice";
import { BRAND_COPY, saveStatusText, type SaveStatus } from "@/lib/dashboardV3/brandDefinition";
import type { SiteBrand } from "@/lib/dashboardV3/brandLook";
import { TabBar } from "./HubFrame";
import { errMsg, hubApi } from "./hubApi";

type Meta = { htmlTitle: string; favicon: string; metaDescription: string; ogImageUrl: string };
export type HubBrand = { name?: string; colors?: string[]; primaryColor?: string; logoUrl?: string } | null;

/**
 * The brand of one site, in plain words: it saves itself (no button), shows which brand is selected and that it is saved, and
 * offers "Switch brand" quietly. Sign-in happens by itself for people signed in with Charisol; otherwise there is one clear step.
 */
export function BrandSaved({ siteId, siteName, isRaw, client, preview, previewState, reloadKey = 0, onState, onSwitchReady, summary, onEdit }: { siteId: string; siteName: string; isRaw: boolean; client?: StrataPickerClient; preview?: boolean; previewState?: BrandState; reloadKey?: number; /** Tells the page what the brand looks like now (null: brands aren't available here). */ onState?: (state: BrandState | null) => void; /** Gives the page a way to open "Switch brand" (for the help panel). */ onSwitchReady?: (open: () => void) => void; /** The compact look of the brand, shown inside the card. */ summary?: React.ReactNode; /** Shows "Edit brand" and calls this when it is pressed. */ onEdit?: () => void }) {
  const { show } = useToast();
  const [available, setAvailable] = useState<boolean | null>(previewState ? true : null);
  const [state, setState] = useState<BrandState | null>(previewState ?? null);
  const [picking, setPicking] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [more, setMore] = useState(false);
  const tried = useRef(false);
  const path = `/api/v1/sites/${encodeURIComponent(siteId)}/brand`;
  const call = useCallback((init?: { method: string; json?: unknown }) => hubApi<BrandState>(path, init, "We couldn't update your brand. Please try again."), [path]);
  const adapter = useMemo(() => client ?? createStrataAdapter(), [client]);
  const report = useRef(onState);
  report.current = onState;

  useEffect(() => { onSwitchReady?.(() => setPicking(true)); }, [onSwitchReady]);

  // Saves the brand by itself the first time (nothing to press): signs in quietly when Charisol already knows who they are.
  const autoSave = useCallback(async (current: BrandState) => {
    if (preview || tried.current) return;
    tried.current = true;
    setSaving(true);
    setError(null);
    try {
      let signedIn = true;
      try {
        let st = await adapter.status();
        if (!st.connected && "connectQuietly" in adapter && typeof adapter.connectQuietly === "function") st = await adapter.connectQuietly();
        signedIn = st.connected;
      } catch { signedIn = false; }
      const next = await call({ method: "POST", json: { sendToStrata: true } });
      setState(next);
      report.current?.(next);
      if (!next.linked && !signedIn) setNeedsSignIn(true);
      else if (!next.linked) setError("We couldn't save your brand just now. We'll keep trying, or you can try again.");
    } catch (e) {
      setError(errMsg(e, "We couldn't save your brand just now. Please try again."));
    } finally {
      setSaving(false);
    }
    void current;
  }, [adapter, call, preview]);

  useEffect(() => {
    if (previewState) { report.current?.(previewState); return; }
    let off = false;
    adapter
      .available()
      .then(async (on) => {
        if (off) return;
        setAvailable(on);
        if (!on) return report.current?.(null);
        const s = await call();
        if (off) return;
        setState(s);
        report.current?.(s);
        if (!s.linked) void autoSave(s);
      })
      .catch((e) => { if (!off) { setAvailable(true); setError(errMsg(e, "We couldn't load your brand.")); report.current?.(null); } });
    return () => { off = true; };
  }, [adapter, call, previewState, reloadKey, autoSave]);

  async function run(label: string, fn: () => Promise<BrandState | void>, done?: string) {
    setBusy(label);
    setError(null);
    try {
      const next = await fn();
      if (next) { setState(next); report.current?.(next); }
      if (done) show({ title: done, tone: "success" });
    } catch (e) {
      setError(errMsg(e, "Something went wrong. Please try again."));
    } finally {
      setBusy(null);
    }
  }

  if (available === false) return null;
  if (!state) return error ? <p className="plx-field__error" role="alert">{error}</p> : <Card><Skeleton height={20} width="40%" style={{ marginBottom: 14 }} /><Skeleton height={48} /></Card>;

  const resolved = state.resolved ?? null;
  const canCreate = !!resolved?.colours.some((c) => c.role === "primary");
  const onDone = (next: Record<string, unknown>, message: string) => {
    const s = next as unknown as BrandState;
    setState(s);
    report.current?.(s);
    setPicking(false);
    setNeedsSignIn(false);
    show({ title: message, tone: "success" });
  };

  const switchModal = (
    <Modal open={picking} onClose={() => setPicking(false)} title={BRAND_COPY.switchTitle} description={BRAND_COPY.switchSub}>
      <StrataBrandPicker mode="site" siteId={siteId} siteName={siteName} client={client} currentProjectId={state.projectId} canCreate={canCreate} preview={preview} onDone={onDone} onCancel={() => setPicking(false)} onConnected={() => undefined} />
    </Modal>
  );

  // Not saved yet: either it is saving right now, or one clear step is left (signing in).
  if (!state.linked) {
    return (
      <>
        <Card data-tour="hub-brand-pending">
          {needsSignIn ? (
            <div className="plx-bsaved">
              <div className="plx-bsaved__text"><b>{BRAND_COPY.signInTitle}</b><span className="plx-small">{BRAND_COPY.signInText}</span></div>
              <Button loading={busy === "connect"} onClick={() => run("connect", async () => {
                const st = await adapter.connect();
                if (!st.connected) return;
                setNeedsSignIn(false);
                return call({ method: "POST", json: { sendToStrata: true } });
              })}>{BRAND_COPY.signInButton}</Button>
            </div>
          ) : (
            <div className="plx-bsaved" role="status">
              <div className="plx-bsaved__text"><b>{saving ? BRAND_COPY.saving : "Getting your brand ready"}</b></div>
              {!saving ? <Button variant="secondary" size="sm" onClick={() => { tried.current = false; void autoSave(state); }}>Try again</Button> : null}
            </div>
          )}
          {error ? <GateOrError error={error}><p className="plx-field__error" role="alert">{error}</p></GateOrError> : null}
        </Card>
        {switchModal}
      </>
    );
  }

  const headline = brandHeadline(state);
  const tone = headline.tone === "bad" ? "inlinemsg--bad" : headline.tone === "warn" ? "inlinemsg--warn" : "";
  const status: SaveStatus = state.sendPending ? "waiting" : error ? "error" : "saved";
  const dot = resolved?.colours.find((c) => c.role === "primary")?.value;
  return (
    <>
    <Card data-tour="hub-brand-strata">
      <div className="plx-bsaved">
        <span className="plx-bsaved__mark" aria-hidden><Check size={20} /></span>
        <div className="plx-bsaved__text">
          <b>{BRAND_COPY.saved}</b>
          <span className="plx-small" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {dot ? <i aria-hidden style={{ width: 12, height: 12, borderRadius: "50%", background: dot, border: "1px solid var(--plx-border)" }} /> : null}
            <span><b>{state.projectName ?? "Your brand"}</b> is selected</span>
            <span className="plx-bsaved__pill" role="status"><Check size={13} aria-hidden />{saveStatusText(status)}</span>
          </span>
        </div>
        {onEdit ? <Button variant="secondary" size="sm" onClick={onEdit}>Edit brand</Button> : null}
        <Button variant="secondary" size="sm" onClick={() => setPicking(true)}>{BRAND_COPY.switchBrand}</Button>
        <Button variant="secondary" size="sm" aria-expanded={more} onClick={() => setMore((m) => !m)}>{more ? "Fewer options" : "More options"}</Button>
      </div>
      {summary}
      <p className="plx-bsaved__foot">{BRAND_COPY.footnote}{state.projectId ? <> · <a href={strataBrandBibleUrl(state.projectId)} target="_blank" rel="noreferrer">Open <ExternalLink size={12} aria-hidden style={{ verticalAlign: "-1px" }} /></a></> : null}</p>
      {headline.tone !== "ok" ? <div className={`plx-inlinemsg ${tone ? "plx-" + tone : ""}`} role="status" style={{ marginTop: 10 }}>{headline.text}</div> : null}
      {error ? <GateOrError error={error}><p className="plx-field__error" role="alert" style={{ marginTop: 12 }}>{error}</p></GateOrError> : null}

      {more ? (
        <>
          <div className="plx-settings" style={{ marginTop: 14 }}>
            <label className="plx-toggle">
              <span>
                <b>Keep my website up to date</b>
                <span className="plx-small" style={{ display: "block" }}>
                  {state.autoSync ? "When you change your brand, your website follows within a couple of minutes." : "Your site keeps its current look until you turn this back on."}
                </span>
              </span>
              <input type="checkbox" className="plx-switch" checked={state.autoSync} disabled={busy !== null || state.status !== "active"} aria-label="Keep my website up to date" onChange={(e) => run("sync", () => call({ method: "PATCH", json: { autoSync: e.target.checked } }))} />
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
              <Button variant="secondary" leftIcon={<RefreshCw size={16} aria-hidden />} loading={busy === "now"} onClick={() => run("now", () => call({ method: "PATCH", json: { syncNow: true } }))}>Refresh my brand</Button>
            )}
            {state.sendPending ? <Button variant="secondary" loading={busy === "send"} onClick={() => run("send", () => call({ method: "POST", json: { sendToStrata: true } }))}>Save now</Button> : null}
            <Button variant="ghost" style={{ color: "var(--plx-danger)" }} onClick={() => setConfirmStop(true)}>Stop using this brand</Button>
          </div>
        </>
      ) : null}
      {switchModal}
      <Modal
        open={confirmStop}
        onClose={() => setConfirmStop(false)}
        title="Stop using this brand?"
        description="Your pages go back to the colours and fonts they were built with. You can choose a brand again any time."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmStop(false)}>Keep it</Button>
            <Button variant="danger" loading={busy === "unlink"} onClick={() => run("unlink", () => call({ method: "DELETE" }), "Brand removed").then(() => { setConfirmStop(false); tried.current = false; })}>Stop using it</Button>
          </>
        }
      >
        <span />
      </Modal>
    </Card>
    </>
  );
}

/** The brand's ready-made components (buttons, cards...), kept with the brand. SOL and any AI helper use them before inventing their own. */
export function BrandComponents({ components, projectId }: { components: Array<{ name: string; variants: string[]; slots: Array<{ role: string }> }>; projectId: string | null }) {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return (
    <Card data-tour="hub-brand-components">
      <CardHeader
        title="Ready-made pieces"
        description={components.length ? "Buttons, cards and other pieces from your brand. SOL and your AI helpers use these first, so everything you build matches." : "Your brand has no ready-made pieces yet. When SOL or your AI helper builds something you want to reuse, like a button or a card, they can save it here for you."}
        action={projectId ? <a className="plx-btn plx-btn--secondary plx-btn--sm" href={strataBrandBibleUrl(projectId)} target="_blank" rel="noreferrer" style={{ whiteSpace: "nowrap" }}>Saved to design system <ExternalLink size={14} aria-hidden /></a> : undefined}
      />
      {components.length ? (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
          {components.map((c) => (
            <li key={c.name} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between", padding: "10px 14px", borderRadius: 12, background: "var(--plx-tint)", border: "1px solid var(--plx-border)" }}>
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

/** Your brand: what it is (colours, fonts, logo, corners), whether it is saved, and the little things that make a site look like yours in a browser tab and when shared. */
export function BrandTab({ siteId, siteName, brand, defaults = null, sourceType = "BUILDER", strataClient, strataPreviewState, strataPreviewVoice }: { siteId: string; siteName: string; brand: SiteBrand | null; defaults?: HubBrand; experience?: string; sourceType?: string; /** Dev preview only. */ strataClient?: StrataPickerClient; strataPreviewState?: BrandState; /** Dev preview only. */ strataPreviewVoice?: BrandVoice | null }) {
  const { show } = useToast();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [brandState, setBrandState] = useState<BrandState | null>(null);
  const [brandKnown, setBrandKnown] = useState(!!strataPreviewState);
  const [reloadKey, setReloadKey] = useState(0);
  // The editor is folded away once a brand is set up; it opens with "Edit brand" and is remembered only for this visit.
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState({ look: false, words: false });
  const [leaving, setLeaving] = useState(false);
  const onLookDirty = useCallback((d: boolean) => setDirty((x) => (x.look === d ? x : { ...x, look: d })), []);
  const onWordsDirty = useCallback((d: boolean) => setDirty((x) => (x.words === d ? x : { ...x, words: d })), []);
  const anyDirty = dirty.look || dirty.words;
  useEffect(() => {
    if (!anyDirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyDirty]);
  const openSwitch = useRef<(() => void) | null>(null);
  const onSwitchReady = useCallback((open: () => void) => { openSwitch.current = open; }, []);
  const onState = useCallback((s: BrandState | null) => { setBrandState(s); setBrandKnown(true); }, []);
  // A brand that is set up (saved, with colours) is shown as a compact card; the full editor is for first-time set-up and "Edit brand".
  const setUp = !!brandState?.linked && !!brandState.resolved?.colours.length;
  const showEditor = brandKnown && (!setUp || editing);
  // A save folds the editor away again, unless the other half still has unsaved changes.
  const dirtyNow = useRef(dirty);
  dirtyNow.current = dirty;
  const afterSaved = useCallback((part: "look" | "words") => {
    setReloadKey((k) => k + 1);
    setTimeout(() => { if (!(part === "look" ? dirtyNow.current.words : dirtyNow.current.look)) setEditing(false); }, 0);
  }, []);
  const suggestion = suggestedMetaDescription(brandState?.resolved?.words, siteName);
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
      <TabBar title={BRAND_COPY.pageTitle} sub={BRAND_COPY.pageSub} titleAddon={<BrandHelp onSwitch={() => openSwitch.current?.()} canSwitch={brandState !== null} />} />
      <div className="plx-hub__col" data-tour="hub-brand">
        <BrandSaved siteId={siteId} siteName={siteName} isRaw={sourceType === "RAW_UPLOAD"} client={strataClient} preview={!!strataClient} previewState={strataPreviewState} reloadKey={reloadKey} onState={onState} onSwitchReady={onSwitchReady} summary={setUp && brandState?.resolved ? <BrandSummary brand={brandState.resolved} /> : undefined} onEdit={setUp && !editing ? () => setEditing(true) : undefined} />
        {showEditor ? (
          <>
            {setUp ? (
              <div className="plx-brandedit" role="region" aria-label="Editing your brand">
                <span><b>Editing your brand</b><span className="plx-small" style={{ display: "block" }}>Change anything, then press Save. When you are finished, press Done.</span></span>
                <span style={{ display: "flex", gap: 8 }}>
                  <Button variant="secondary" onClick={() => (anyDirty ? setLeaving(true) : setEditing(false))}>Cancel</Button>
                  <Button onClick={() => (anyDirty ? setLeaving(true) : setEditing(false))}>Done</Button>
                </span>
              </div>
            ) : null}
            <BrandDefinition key={brandState?.projectId ?? "own"} siteId={siteId} siteName={siteName} own={brand} defaults={defaults} sourceType={sourceType} resolved={brandState?.resolved ?? null} onDirty={onLookDirty} onSaved={() => afterSaved("look")} />
            <BrandWords siteId={siteId} siteName={siteName} preview={!!strataClient} previewVoice={strataPreviewVoice} onDirty={onWordsDirty} onSaved={() => afterSaved("words")} />
          </>
        ) : !brandKnown ? <Card><Skeleton height={20} width="40%" style={{ marginBottom: 14 }} /><Skeleton height={160} /></Card> : null}
        <Modal
          open={leaving}
          onClose={() => setLeaving(false)}
          title="Leave without saving?"
          description="You have changes that aren't saved yet. Press Save on the part you changed to keep them, or leave and they will be lost."
          footer={<><Button variant="secondary" onClick={() => setLeaving(false)}>Keep editing</Button><Button variant="danger" onClick={() => { setLeaving(false); setEditing(false); setDirty({ look: false, words: false }); setReloadKey((k) => k + 1); }}>Leave without saving</Button></>}
        >
          <span />
        </Modal>
      <div className="plx-hub__split">
        <BrandComponents components={brandState?.resolved?.components ?? []} projectId={brandState?.projectId ?? null} />
        <Card>
          <CardHeader title="Browser tab and sharing" description="What people see in their browser tab and when your link is shared." />
          {meta ? (
            <div className="plx-form">
              <Input label="Title in the browser tab" value={meta.htmlTitle ?? ""} onChange={(e) => setMeta({ ...meta, htmlTitle: e.target.value })} placeholder={siteName} />
              <Textarea label="One sentence about your site" help={!meta.metaDescription && suggestion ? <>Shown when your link is shared or found online. <Button variant="link" onClick={() => setMeta({ ...meta, metaDescription: suggestion })}>Use the words from Your words</Button></> : "Shown when your link is shared or found online."} value={meta.metaDescription ?? ""} placeholder={suggestion || undefined} onChange={(e) => setMeta({ ...meta, metaDescription: e.target.value })} style={{ minHeight: 88 }} />
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span className="plx-hrow__thumb" style={{ width: 48, height: 48 }}>{meta.favicon ? <img src={meta.favicon} alt="" /> : <ImagePlus size={20} aria-hidden />}</span>
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && icon(e.target.files[0])} />
                <Button variant="secondary" loading={uploading} onClick={() => fileRef.current?.click()}>{meta.favicon ? "Change small icon" : "Add a small icon"}</Button>
              </div>
              {error ? <GateOrError error={error}><p className="plx-field__error" role="alert">{error}</p></GateOrError> : null}
              <div><Button loading={busy} onClick={save}>Save</Button></div>
            </div>
          ) : error ? <p className="plx-field__error" role="alert">{error}</p> : <div className="plx-form"><Skeleton height={48} /><Skeleton height={88} /></div>}
        </Card>
      </div>
      </div>
    </>
  );
}
