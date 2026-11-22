"use client";

import "./strataPicker.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Link2, Plus } from "lucide-react";
import { Button, OptimisticLoader, Skeleton } from "../ui";
import { createStrataAdapter } from "@/app/dashboard/apps/_components/strataAdapter";
import { brandFromDesignSystem, type ResolvedBrand } from "@/lib/brand/brandModel";
import {
  canLink, confirmationText, needsSwitchConfirmation, NO_SELECTION, switchWarning, PICKER_COPY, projectInitial, sortProjects, stageFor, toggleSelection,
  type PickerProject, type PickerSelection,
} from "@/lib/dashboardV3/strataPicker";
import { errMsg, hubApi } from "../hub/hubApi";

/** What the picker needs from Strata (the real one is the editor's adapter; the dev preview passes a fake). */
export type StrataPickerClient = {
  available(): Promise<boolean>;
  status(): Promise<{ connected: boolean; user?: { email?: string; name?: string } }>;
  connect(options?: { switchAccount?: boolean }): Promise<{ connected: boolean; user?: { email?: string; name?: string } }>;
  /** Connects in the background as the person already signed in with Charisol (never opens a window). */
  connectQuietly?(): Promise<{ connected: boolean; user?: { email?: string; name?: string } }>;
  listProjects(): Promise<PickerProject[]>;
  /** A project's colours and fonts, to preview them before the website is made. */
  pull?(projectId: string): Promise<{ tokens: unknown[] }>;
};

/** The colours the picker found in a project (draft mode), so the screen around it can use them for designs. */
export type PickedBrand = { projectId: string; name: string; colors: string[]; logoUrl: string | null };

type Common = {
  client?: StrataPickerClient;
  /** Smaller list, for use inside a larger screen (onboarding). */
  compact?: boolean;
  /** Offer "Create a Strata brand from mine". Off when there are no colours to send yet. */
  canCreate?: boolean;
  /** Shown instead of the create option's text when it is off. */
  createHint?: string;
};
type DraftProps = Common & {
  /** The site isn't made yet: the picker only reports the choice; the screen sends it with the new-site request. */
  mode: "draft";
  value: PickerSelection;
  onChange: (next: PickerSelection, picked?: PickedBrand | null) => void;
  /** Offer "Skip for now" as a visible choice (set it when the screen has no Continue-without button of its own). */
  allowSkip?: boolean;
  /** Called with whether Strata is on at all, so a screen can leave the step out when it is not. */
  onAvailable?: (available: boolean) => void;
};
type SiteProps = Common & {
  /** The site exists: choosing links it (or creates the project) straight away. */
  mode: "site";
  siteId: string;
  siteName: string;
  /** The project this site uses now (marked, listed first). */
  currentProjectId?: string | null;
  onDone: (state: Record<string, unknown> & { resolved?: ResolvedBrand | null }, message: string) => void;
  onCancel?: () => void;
  /** Called once Strata has just been connected, so the screen can finish the set-up without another click. */
  onConnected?: () => void;
  /** Dev preview only: pretend the link / create calls worked. */
  preview?: boolean;
};

export function StrataBrandPicker(props: DraftProps | SiteProps) {
  const client = useMemo<StrataPickerClient>(() => props.client ?? (createStrataAdapter() as unknown as StrataPickerClient), [props.client]);
  const onAvailable = props.mode === "draft" ? props.onAvailable : undefined;
  const [available, setAvailable] = useState<boolean | null>(null);
  const [connected, setConnected] = useState(false);
  const [projects, setProjects] = useState<PickerProject[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"connect" | "link" | "create" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<PickerSelection>(NO_SELECTION);
  const [autoSync, setAutoSync] = useState(true);
  const [done, setDone] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  /** What the chosen brand looks like (colours and fonts), shown so the owner sees what they are picking. */
  const [look, setLook] = useState<{ name: string; colors: string[]; heading?: string; body?: string } | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const selection = props.mode === "draft" ? props.value : local;
  const currentId = props.mode === "site" ? props.currentProjectId : null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const on = await client.available();
      if (!alive.current) return;
      setAvailable(on);
      onAvailable?.(on);
      if (!on) return;
      let st: { connected: boolean; user?: { email?: string } } = await client.status().catch(() => ({ connected: false }));
      // Charisol sign-in already tells us who they are, so connect for them in the background instead of asking.
      if (!st.connected && client.connectQuietly) st = await client.connectQuietly().catch(() => ({ connected: false }));
      if (!alive.current) return;
      setConnected(st.connected);
      setAccount(st.user?.email ?? null);
      if (st.connected) setProjects(await client.listProjects());
    } catch (e) {
      if (alive.current) setError(errMsg(e, "We couldn't load your brands. Please try again."));
    } finally {
      if (alive.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);
  useEffect(() => { void load(); }, [load]);

  const connect = async (switchAccount = false) => {
    setBusy("connect");
    setError(null);
    try {
      const st = await client.connect(switchAccount ? { switchAccount: true } : undefined);
      setConnected(st.connected);
      setAccount(st.user?.email ?? null);
      if (st.connected) {
        setProjects(await client.listProjects());
        if (props.mode === "site") props.onConnected?.();
      }
    } catch (e) {
      setError(errMsg(e, "We couldn't sign you in. Please try again."));
    } finally {
      setBusy(null);
    }
  };

  const stage = stageFor({ available, connected, loading, error, projects });
  const sorted = useMemo(() => sortProjects(projects ?? [], currentId), [projects, currentId]);

  const choose = async (next: PickerSelection) => {
    const value = toggleSelection(selection, next);
    if (props.mode === "draft") {
      let picked: PickedBrand | null = null;
      if (value.kind === "project" && client.pull) {
        const p = projects?.find((x) => x.id === value.id);
        try {
          const ds = await client.pull(value.id);
          const b = brandFromDesignSystem({ tokens: ds.tokens as never, name: p?.name });
          picked = { projectId: value.id, name: value.name, colors: b.colours.filter((c) => /^#[0-9a-f]{6}$/i.test(c.value)).map((c) => c.value).slice(0, 4), logoUrl: p?.logo ?? null };
          setLook({ name: value.name, colors: picked.colors, heading: b.fonts.heading, body: b.fonts.body });
        } catch { picked = { projectId: value.id, name: value.name, colors: p?.color ? [p.color] : [], logoUrl: p?.logo ?? null }; setLook({ name: value.name, colors: picked.colors }); }
      } else setLook(null);
      props.onChange(value, picked);
    } else setLocal(value);
  };

  const apply = async () => {
    if (props.mode !== "site") return;
    const sel = selection;
    if (sel.kind !== "project" && sel.kind !== "create") return;
    setConfirming(false);
    setBusy(sel.kind === "create" ? "create" : "link");
    setError(null);
    try {
      let state: Record<string, unknown> & { resolved?: ResolvedBrand | null; created?: { project?: { name?: string }; notes?: string[] } };
      if (props.preview) {
        await new Promise((r) => setTimeout(r, 500));
        state = { linked: true, projectName: sel.kind === "project" ? sel.name : props.siteName, created: sel.kind === "create" ? { project: { name: props.siteName }, notes: [] } : undefined };
      } else {
        state = await hubApi(`/api/v1/sites/${encodeURIComponent(props.siteId)}/brand`, { method: "POST", json: sel.kind === "project" ? { projectId: sel.id, projectName: sel.name, autoSync } : { createProject: true, name: props.siteName, autoSync } }, "We couldn't connect your brand. Please try again.");
      }
      const name = sel.kind === "project" ? sel.name : state.created?.project?.name ?? props.siteName;
      const message = confirmationText({ projectName: name, created: sel.kind === "create", autoSync, notes: state.created?.notes });
      setDone(message);
      props.onDone(state, message);
    } catch (e) {
      setError(errMsg(e, "We couldn't connect your brand. Please try again."));
    } finally {
      setBusy(null);
    }
  };

  const createOn = props.canCreate !== false;
  const createOption = (
    <button
      type="button"
      role="radio"
      aria-checked={selection.kind === "create"}
      className="plx-sbp__opt"
      disabled={!createOn || busy !== null}
      onClick={() => void choose({ kind: "create" })}
    >
      <span className="plx-sbp__mark plx-sbp__mark--create" aria-hidden><Plus size={22} /></span>
      <span className="plx-sbp__text">
        <span className="plx-sbp__name">{PICKER_COPY.createTitle}</span>
        <span className="plx-sbp__sub">{createOn ? PICKER_COPY.createText : props.createHint ?? PICKER_COPY.createNeedsColours}</span>
      </span>
      <span className="plx-sbp__check" aria-hidden><Check size={16} /></span>
    </button>
  );

  const skip = props.mode === "draft" && props.allowSkip ? (
    <div className="plx-sbp__foot">
      <Button variant={selection.kind === "skip" ? "secondary" : "ghost"} onClick={() => props.onChange({ kind: "skip" }, null)}>{PICKER_COPY.skip}</Button>
      <p className="plx-sbp__note" style={{ flex: 1, minWidth: 200 }}>{selection.kind === "skip" ? PICKER_COPY.skipNote : ""}</p>
    </div>
  ) : null;

  if (stage === "unavailable") return null;
  const cls = `plx-sbp${props.compact ? " plx-sbp--compact" : ""}`;

  if (stage === "loading") {
    return (
      <div className={cls} role="status" aria-live="polite" aria-label="Loading your brands" style={{ padding: "32px 16px", display: "grid", placeItems: "center" }}>
        <OptimisticLoader title="Connecting to brand library" subtitle="Retrieving logos, colors, and typography" steps={["Connecting to brand workspace…", "Loading brand assets and palettes…", "Ready."]} />
      </div>
    );
  }

  if (stage === "not-connected") {
    return (
      <div className={cls}>
        <div className="plx-sbp__box">
          <h3>{PICKER_COPY.connectTitle}</h3>
          <p>{props.mode === "site" ? PICKER_COPY.connectSiteText : PICKER_COPY.connectText}</p>
          <Button leftIcon={<Link2 size={18} aria-hidden />} loading={busy === "connect"} onClick={() => void connect()}>{PICKER_COPY.connectButton}</Button>
          <p className="plx-sbp__note">{PICKER_COPY.notConnectedNote}</p>
        </div>
        {error ? <p className="plx-sbp__err" role="alert">{error}</p> : null}
        {skip}
      </div>
    );
  }

  if (stage === "error") {
    return (
      <div className={cls}>
        <p className="plx-sbp__err" role="alert">{error}</p>
        <div><Button variant="secondary" onClick={() => void load()}>{PICKER_COPY.retry}</Button></div>
        {skip}
      </div>
    );
  }

  const list = stage === "list" ? (
    <div className="plx-sbp__list" role="radiogroup" aria-label="Your saved brands">
      {sorted.map((p) => {
        const checked = selection.kind === "project" && selection.id === p.id;
        const editable = canLink(p);
        return (
          <button key={p.id} type="button" role="radio" aria-checked={checked} className="plx-sbp__opt" disabled={!editable || busy !== null} onClick={() => void choose({ kind: "project", id: p.id, name: p.name })}>
            <span className="plx-sbp__mark" aria-hidden>
              {p.logo ? <img src={p.logo} alt="" /> : projectInitial(p.name)}
              {p.color ? <i className="plx-sbp__dot" style={{ background: p.color }} /> : null}
            </span>
            <span className="plx-sbp__text">
              <span className="plx-sbp__name">{p.name}</span>
              <span className="plx-sbp__sub">{!editable ? PICKER_COPY.viewOnly : p.id === currentId ? "Selected: your website uses this" : p.description || (p.updatedAt ? `Edited ${new Date(p.updatedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : "Colours, fonts and logo")}</span>
            </span>
            <span className="plx-sbp__check" aria-hidden><Check size={16} /></span>
          </button>
        );
      })}
    </div>
  ) : (
    <div className="plx-sbp__box">
      <h3>{PICKER_COPY.emptyTitle}</h3>
      <p>{PICKER_COPY.emptyText}</p>
    </div>
  );

  const accountLine = account || connected ? (
    <p className="plx-sbp__note" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: 0 }}>
      <span>{account ? <>Showing the brands of <b>{account}</b>.</> : "You are signed in."}</span>
      <Button variant="ghost" size="sm" loading={busy === "connect"} onClick={() => void connect(true)}>Use a different account</Button>
    </p>
  ) : null;

  return (
    <div className={cls}>
      {accountLine}
      {list}
      {createOption}
      {props.mode === "site" ? (
        <>
          <label className="plx-sbp__sync">
            <span><b>{PICKER_COPY.syncTitle}</b><span>{autoSync ? PICKER_COPY.syncOn : PICKER_COPY.syncOff}</span></span>
            <input type="checkbox" className="plx-switch" checked={autoSync} aria-label={PICKER_COPY.syncTitle} onChange={(e) => setAutoSync(e.target.checked)} />
          </label>
          {error ? <p className="plx-sbp__err" role="alert">{error}</p> : null}
          {confirming && (selection.kind === "project" || selection.kind === "create") ? (() => {
            const w = switchWarning({ siteName: props.siteName, toName: selection.kind === "project" ? selection.name : props.siteName, created: selection.kind === "create", autoSync });
            return (
              <div className="plx-sbp__box" role="alertdialog" aria-label={w.title}>
                <h3>{w.title}</h3>
                {w.lines.map((l) => <p key={l}>{l}</p>)}
                <div className="plx-sbp__foot">
                  <Button variant="ghost" onClick={() => setConfirming(false)}>Keep my current brand</Button>
                  <Button loading={busy === "link" || busy === "create"} onClick={() => void apply()}>{w.confirm}</Button>
                </div>
              </div>
            );
          })() : null}
          {done ? <p className="plx-sbp__done" role="status"><Check size={18} aria-hidden />{done}</p> : null}
          <div className="plx-sbp__foot">
            {props.onCancel ? <Button variant="ghost" onClick={props.onCancel}>Cancel</Button> : <span />}
            <Button loading={busy === "link" || busy === "create"} disabled={selection.kind !== "project" && selection.kind !== "create"} onClick={() => (needsSwitchConfirmation({ currentProjectId: currentId, selection }) ? setConfirming(true) : void apply())}>
              {selection.kind === "create" ? "Save my brand" : currentId ? "Switch to this brand" : "Use this brand"}
            </Button>
          </div>
        </>
      ) : (
        <>
          {selection.kind === "project" && look?.name === selection.name && (look.colors.length || look.heading || look.body) ? (
            <div className="plx-sbp__look" aria-label={`Colours and fonts of ${look.name}`}>
              <span className="plx-sbp__dots">{look.colors.map((c) => <i key={c} style={{ background: c }} title={c} />)}</span>
              {look.heading || look.body ? <span className="plx-sbp__fonts">{[look.heading, look.body].filter((f, i, a): f is string => !!f && a.indexOf(f) === i).join(" + ")}</span> : null}
            </div>
          ) : null}
          {selection.kind === "project" || selection.kind === "create" ? <p className="plx-sbp__note">{PICKER_COPY.deferred}</p> : null}
          {skip}
        </>
      )}
    </div>
  );
}

