"use client";

import "./newsite.css";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, FilePlus2, LoaderCircle, Truck } from "lucide-react";
import { Button, ButtonLink, Input, Modal, Notice } from "../ui";
import { CURRENT_SITE_COOKIE } from "@/lib/dashboardV3/sites";
import { siteHubHref } from "@/lib/dashboardV3/hubPaths";
import {
  afterFork, appHref, paidDesignFrom, PAID_RETRY, PENDING_KEY, readPending, defaultSiteName, designPicks, isAppGoal, limitNote, MORE_WAYS, NEW_SITE_GOALS, OTHER_EDITOR_HREF, STARTS,
  type NewSiteGoal, type Start,
} from "@/lib/dashboardV3/newSite";
import type { SolBuildProfile } from "@/lib/ai/solBuildContext";
import { ScaledFrame } from "./ScaledFrame";
import { SeeAllDesigns } from "./SeeAllDesigns";
import type { PickerDesign } from "../designs/DesignPicker";

export type NewSiteContext = {
  plan: string;
  /** The owner's saved brand: its name is the suggested site name and its colours/logo are used for the designs. */
  brand: SolBuildProfile["brand"] | null;
  siteNames: string[];
  liveSiteNames: string[];
};

type Screen = "fork" | "goal" | "look" | "all" | "making";
type Design = { id: string; name: string; description: string; html?: string };

const STEP_OF: Record<Screen, string> = { fork: "", goal: "Step 1 of 3: What is it for?", look: "Step 2 of 3: Pick a look", all: "Step 2 of 3: All designs", making: "Step 3 of 3: Making your website" };

/** Make a new website: choose new or move one, what it is for + a name, three designs, then it is made. A dialog (phones: a full sheet) or a page. */
export function NewSiteFlow({ mode, context, onClose, preview }: { mode: "dialog" | "page"; context: NewSiteContext; onClose?: () => void; /** Dev preview only: open on a later screen. */ preview?: { screen: "goal" | "look" | "all"; goal: NewSiteGoal; mock?: boolean } }) {
  const flow = <Steps mode={mode} context={context} onClose={onClose} preview={preview} />;
  if (mode === "page") return <div className="plx-page plx-ns plx-ns--page">{flow}</div>;
  return (
    <Modal open onClose={onClose ?? (() => {})} title="Make a new website" width={1000} closeOnBackdrop={false}>
      <div className="plx-ns">
      {flow}
      </div>
    </Modal>
  );
}

function Steps({ mode, context, onClose, preview }: { mode: "dialog" | "page"; context: NewSiteContext; onClose?: () => void; preview?: { screen: "goal" | "look" | "all"; goal: NewSiteGoal; mock?: boolean } }) {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>(preview?.screen === "goal" ? "goal" : preview?.screen === "all" ? "all" : "fork");
  const [goal, setGoal] = useState<NewSiteGoal | "">(preview?.goal ?? "");
  const [name, setName] = useState(() => defaultSiteName(context.brand?.name, "", context.siteNames));
  const [nameEdited, setNameEdited] = useState(false);
  const [designs, setDesigns] = useState<Design[]>([]);
  const [total, setTotal] = useState(0);
  const [designId, setDesignId] = useState("");
  const [error, setError] = useState("");
  const [loadingDesigns, setLoadingDesigns] = useState(false);
  const request = useRef(0);
  const note = useMemo(() => limitNote(context.plan, context.liveSiteNames), [context.plan, context.liveSiteNames]);
  const brand = context.brand ?? undefined;

  const pickGoal = (g: NewSiteGoal) => {
    setGoal(g);
    if (!nameEdited) setName(defaultSiteName(context.brand?.name, g, context.siteNames));
  };

  const start = (s: Start) => {
    const next = afterFork(s);
    if (next.kind === "go") {
      onClose?.();
      router.push(next.href);
    } else setScreen("goal");
  };

  const toLook = async () => {
    if (!goal) return;
    if (isAppGoal(goal)) {
      onClose?.();
      router.push(appHref(name));
      return;
    }
    if (!name.trim()) return setError("Give your website a name, like your business name.");
    setError("");
    setScreen("look");
    setDesigns([]);
    setLoadingDesigns(true);
    const id = ++request.current;
    try {
      const res = await fetch("/api/onboarding/designs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile: { goal, brand: { ...(brand ?? {}), name: name.trim() } } }) });
      const data = await res.json();
      if (id !== request.current) return;
      if (!res.ok) throw new Error(data?.error || "");
      setDesigns(data.designs);
      setTotal(data.total);
      setDesignId(data.designs[0]?.id ?? "");
    } catch {
      if (id === request.current) setError("We couldn't show the designs just now. You can still make your website: we'll pick a good one for you.");
    } finally {
      if (id === request.current) setLoadingDesigns(false);
    }
  };

  /** Makes the site (from the kit design, or from a marketplace design) and opens it. A just-paid design may need a few tries while the payment is recorded. */
  const make = async (extra: { designId?: string; marketDesignId?: string }, who: { goal: NewSiteGoal; name: string }, tries = 1) => {
    setError("");
    setScreen("making");
    try {
      if (preview?.mock) { await new Promise((r) => setTimeout(r, 600)); setScreen("look"); return; }
      for (let i = 0; i < tries; i++) {
        const res = await fetch("/api/dashboard/new-site", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goal: who.goal, name: who.name, ...extra }) });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.site) {
          try { document.cookie = `${CURRENT_SITE_COOKIE}=${encodeURIComponent(data.site.id)}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`; sessionStorage.removeItem(PENDING_KEY); } catch { /* the server set it too */ }
          onClose?.();
          router.push(siteHubHref(data.site.id));
          router.refresh();
          return;
        }
        if (data?.needsPurchase && i < tries - 1) { await new Promise((r) => setTimeout(r, PAID_RETRY.delayMs)); continue; }
        throw new Error(typeof data?.error === "string" && data.error ? data.error : "");
      }
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "We couldn't make your website just now. Nothing was lost: please try again.");
      setScreen(extra.marketDesignId ? "all" : "look");
    }
  };
  const create = () => (goal ? make({ designId }, { goal, name: name.trim() }) : undefined);
  const useMarketDesign = (d: PickerDesign) => (goal ? make({ marketDesignId: d.id }, { goal, name: name.trim() }) : undefined);

  // Back from paying for a design in the card window (?paidDesign=): make the site from it with what they had typed.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || preview || typeof window === "undefined") return;
    const paid = paidDesignFrom(window.location.search);
    if (!paid) return;
    resumed.current = true;
    let saved = null;
    try { saved = readPending(sessionStorage.getItem(PENDING_KEY)); } catch { /* use the defaults */ }
    const who = saved ?? { goal: "business-site" as NewSiteGoal, name: defaultSiteName(context.brand?.name, "business-site", context.siteNames) };
    setGoal(who.goal);
    setName(who.name);
    void make({ marketDesignId: paid }, who, PAID_RETRY.tries);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (preview?.screen === "look") void toLook(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => { /* focus lands on the heading of each screen */ document.getElementById("plx-ns-title")?.focus(); }, [screen]);

  const heading = (title: string, lead?: string) => (
    <div>
      <h1 id="plx-ns-title" tabIndex={-1} className="plx-ns__title" style={{ outline: "none" }}>{title}</h1>
      {lead ? <p className="plx-ns__lead">{lead}</p> : null}
    </div>
  );
  const back = (to: Screen) => (
    <button type="button" className="plx-ns__back" onClick={() => { setError(""); setScreen(to); }}><ArrowLeft size={18} aria-hidden />Back</button>
  );

  if (screen === "fork") {
    const [fresh, move] = STARTS;
    return (
      <>
        {mode === "page" ? heading("Make a new website", "Start fresh, or bring a website you already have.") : null}
        <div className="plx-ns__fork">
          <button type="button" className="plx-ns__big plx-ns__big--main" onClick={() => start("new")}>
            <span className="plx-ns__bigicon" aria-hidden><FilePlus2 size={26} /></span>
            <span className="plx-ns__bigtitle">{fresh.title}</span>
            <span className="plx-ns__bigtext">{fresh.text}</span>
            <span className="plx-ns__bigcta">Start <ArrowRight size={18} aria-hidden /></span>
          </button>
          <button type="button" className="plx-ns__big" onClick={() => start("move")}>
            <span className="plx-ns__bigicon" aria-hidden><Truck size={26} /></span>
            <span className="plx-ns__bigtitle">{move.title}</span>
            <span className="plx-ns__bigtext">{move.text}</span>
            <span className="plx-ns__bigcta">Move my website <ArrowRight size={18} aria-hidden /></span>
          </button>
        </div>
        <p className="plx-ns__other">On Wix, Squarespace or another builder? <Link href={OTHER_EDITOR_HREF} onClick={onClose}>Ask SOL to rebuild it with you</Link>.</p>
        <MoreWays onClose={onClose} />
      </>
    );
  }

  if (screen === "goal") {
    const app = goal !== "" && isAppGoal(goal);
    return (
      <>
        <div className="plx-ns__top">{back("fork")}<p className="plx-ns__step">{STEP_OF.goal}</p></div>
        {heading("What is it for?", "Pick the closest one. You can add more to your website later.")}
        <div className="plx-ns__goals" role="radiogroup" aria-label="What is your website for?">
          {NEW_SITE_GOALS.map((g) => (
            <button key={g.id} type="button" role="radio" aria-checked={goal === g.id} className="plx-ns__goal" onClick={() => pickGoal(g.id)}>
              <span className="plx-ns__goaltitle">{g.title}</span>
              <span className="plx-ns__goaltext">{g.text}</span>
            </button>
          ))}
        </div>
        <Input
          fieldClassName="plx-ns__name"
          label="What is it called?"
          help="Your business name works well. You can change it any time."
          value={name}
          maxLength={80}
          error={error || undefined}
          onChange={(e) => { setName(e.target.value); setNameEdited(true); setError(""); }}
        />
        <div className="plx-ns__actions">
          <span />
          <Button size="lg" disabled={!goal} rightIcon={<ArrowRight size={18} aria-hidden />} onClick={toLook}>{app ? "Build it with SOL" : "Show me designs"}</Button>
        </div>
        {!goal ? <p className="plx-ns__other" style={{ marginTop: -12 }}>Pick one to continue</p> : null}
      </>
    );
  }

  if (screen === "making") {
    return (
      <div className="plx-ns__making" role="status" aria-live="polite">
        <LoaderCircle size={44} className="plx-ns__spin" aria-hidden />
        {heading(`Making ${name.trim() || "your website"}…`, "This takes a few seconds. We're setting up the pages and getting everything ready.")}
      </div>
    );
  }

  if (screen === "all" && goal && goal !== "app") {
    return (
      <>
        <div className="plx-ns__top">{back("look")}<p className="plx-ns__step">{STEP_OF.all}</p></div>
        {heading(`All designs for ${name.trim() || "your website"}`, "Made by designers on Plexo, best fit first. Free ones cost nothing; paid ones are a one-time price. Your logo and colours are added to your Brand page.")}
        {error ? <Notice kind="warning" title="Something went wrong">{error}</Notice> : null}
        <SeeAllDesigns goal={goal} name={name.trim()} brand={brand} mock={preview?.mock} onUse={useMarketDesign} />
      </>
    );
  }

  const list = designs.length ? designs : [null, null, null];
  return (
    <>
      <div className="plx-ns__top">{back("goal")}<p className="plx-ns__step">{STEP_OF.look}</p></div>
      {heading(`Pick a look for ${name.trim() || "your website"}`, "These are already filled in with your name. You can change the words, pictures, colours and the design itself later.")}
      {error ? <Notice kind="warning" title="Something went wrong">{error}</Notice> : null}
      <div className="plx-ns__designs" role="radiogroup" aria-label="Designs">
        {list.map((d, i) => (
          <button key={d?.id ?? i} type="button" role="radio" aria-checked={!!d && designId === d.id} className="plx-ns__design" disabled={!d} onClick={() => d && setDesignId(d.id)}>
            <ScaledFrame html={d?.html ?? null} title={d ? `${d.name} design` : "Loading design"} />
            <span className="plx-ns__designmeta">
              <span><span className="plx-ns__designname">{d?.name ?? (loadingDesigns ? "Loading…" : "")}</span><span className="plx-ns__designtext">{d?.description ?? ""}</span></span>
              <span className="plx-ns__designpick">{d && designId === d.id ? "Chosen" : "Pick"}</span>
            </span>
          </button>
        ))}
      </div>
      {note ? (
        <Notice kind="info" title="Good to know" action={{ label: note.upgradeLabel, href: note.upgradeHref }}>{note.text}</Notice>
      ) : null}
      <div className="plx-ns__actions">
        <Button variant="ghost" onClick={() => { setError(""); setScreen("all"); }}>{total > 3 ? `See all designs (${total})` : "See all designs"}</Button>
        <Button size="lg" disabled={loadingDesigns} rightIcon={<ArrowRight size={18} aria-hidden />} onClick={create}>Create my website</Button>
      </div>
    </>
  );
}

function MoreWays({ onClose }: { onClose?: () => void }) {
  return (
    <nav className="plx-ns__more" aria-label="More ways to start">
      <span className="plx-ns__morelabel">More ways to start</span>
      {MORE_WAYS.map((w) => (
        <ButtonLink key={w.id} href={w.href} variant="link" onClick={onClose}>{w.title}</ButtonLink>
      ))}
    </nav>
  );
}
