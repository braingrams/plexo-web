"use client";

import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import "./newsite.css";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, FilePlus2, Truck } from "lucide-react";
import { Button, ButtonLink, Input, Modal, Notice, OptimisticLoader, Select, Textarea, useToast } from "../ui";
import { BUSINESS_TYPES, businessTypeById, inferBusinessType } from "@/lib/onboarding/businessType";
import { brandPreviewHtml } from "@/lib/onboarding/brandPreview";
import { type PickedBrand, type StrataPickerClient } from "../brand/StrataBrandPicker";
import { NO_SELECTION, selectionToChoice, type PickerSelection } from "@/lib/dashboardV3/strataPicker";
import { createStrataAdapter } from "@/app/dashboard/apps/_components/strataAdapter";
import { CURRENT_SITE_COOKIE } from "@/lib/dashboardV3/sites";
import {
  afterCreateHref, afterFork, appHref, paidDesignFrom, PAID_RETRY, PENDING_KEY, readPending, defaultSiteName, isAppGoal, limitNote, MORE_WAYS, NEW_SITE_NOTICE_KEY, noticeFor, NEW_SITE_GOALS, OTHER_EDITOR_HREF, STARTS,
  type NewSiteGoal, type Start,
} from "@/lib/dashboardV3/newSite";
import type { SolBuildProfile } from "@/lib/ai/solBuildContext";
import { SeeAllDesigns } from "./SeeAllDesigns";
import { HeroDesignPreview } from "./HeroDesignPreview";
import { BrandStepContent } from "./BrandStepContent";
import type { PickerDesign } from "../designs/DesignPicker";
import { CreditModal } from "../sol/CreditModal";
import { SolPersonalizeModal } from "./SolPersonalizeModal";
import { PersonalizeStudio, type PersonalizeResult, type SolEdits } from "./PersonalizeStudio";

export type NewSiteContext = {
  plan: string;
  /** The owner's saved brand: its name is the suggested site name and its colours/logo are used for the designs. */
  brand: SolBuildProfile["brand"] | null;
  siteNames: string[];
  liveSiteNames: string[];
};

type Screen = "fork" | "goal" | "brand" | "look" | "all" | "making";
type Design = { id: string; name: string; description: string; html?: string; /** A new-editor design: its preview and the new site are built by the server from the design itself. */ v2?: boolean };

const STEP_TITLE: Record<Screen, string> = { fork: "", goal: "What is it for?", brand: "Choose colours & logo", look: "Pick a look", all: "All designs", making: "Making your website" };
const STEP_NO: Record<Screen, number> = { fork: 0, goal: 1, brand: 2, look: 3, all: 3, making: 4 };
/** "Step 2 of 4: Your brand". The brand step only exists when Strata is on, so without it the steps are numbered out of 3. */
const stepText = (screen: Screen, withBrand: boolean) => `Step ${withBrand ? STEP_NO[screen] : STEP_NO[screen] - (STEP_NO[screen] > 2 ? 1 : 0)} of ${withBrand ? 4 : 3}: ${STEP_TITLE[screen]}`;

/** Make a new website: choose new or move one, what it is for + a name, three designs, then it is made. A dialog (phones: a full sheet) or a page. */
export function NewSiteFlow({ mode, context, onClose, preview }: { mode: "dialog" | "page"; context: NewSiteContext; onClose?: () => void; /** Dev preview only: open on a later screen. */ preview?: { screen: "goal" | "brand" | "look" | "all"; goal: NewSiteGoal; mock?: boolean; strata?: StrataPickerClient } }) {
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

function Steps({ mode, context, onClose, preview }: { mode: "dialog" | "page"; context: NewSiteContext; onClose?: () => void; preview?: { screen: "goal" | "brand" | "look" | "all"; goal: NewSiteGoal; mock?: boolean; strata?: StrataPickerClient } }) {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>(preview?.screen === "goal" ? "goal" : preview?.screen === "brand" ? "brand" : preview?.screen === "all" ? "all" : "fork");
  const [goal, setGoal] = useState<NewSiteGoal | "">(preview?.goal ?? "");
  const [name, setName] = useState(() => defaultSiteName(context.brand?.name, "", context.siteNames));
  const [nameEdited, setNameEdited] = useState(false);
  const [designs, setDesigns] = useState<Design[]>([]);
  const [total, setTotal] = useState(0);
  // "Briefly describe what you want your website to look like": steers which designs are shown and the words on the site.
  const [about, setAbout] = useState("");
  const [feel, setFeel] = useState<{ industry: string; style: string } | null>(null);
  /** The kind of business the owner picked (empty: let SOL work it out), and what the designs were actually chosen for. */
  const [typePick, setTypePick] = useState("");
  const [typeUsed, setTypeUsed] = useState<{ id: string; label: string; source: string } | null>(null);
  const typeGuess = useMemo(() => {
    const g = inferBusinessType(name, about);
    return g && (g.score >= 5 || (g.score >= 3 && g.margin >= 1.5)) ? businessTypeById(g.id) ?? null : null;
  }, [name, about]);
  const typeOptions = useMemo(() => BUSINESS_TYPES.map((t) => ({ value: t.id, label: t.label })), []);
  const [designId, setDesignId] = useState("");
  const [error, setError] = useState("");
  const [loadingDesigns, setLoadingDesigns] = useState(false);
  const [isContinuing, setIsContinuing] = useState(false);
  // The run number of the SOL Studio open over the preview (null: closed). A new number starts SOL afresh.
  const [studioRun, setStudioRun] = useState<number | null>(null);
  const backTimer = useRef<number | null>(null);
  useEffect(() => () => { if (backTimer.current) window.clearTimeout(backTimer.current); }, []);
  const [isPersonalized, setIsPersonalized] = useState(false);
  const [personalizedHtml, setPersonalizedHtml] = useState<string | null>(null);
  /** SOL's part of a personalized new-editor design (words by number, sections removed...), and the design it belongs to. */
  const [solEdits, setSolEdits] = useState<{ designId: string; edits: SolEdits } | null>(null);
  /** The server-built preview of a new-editor design with the owner's name, description, colour and logo on it (null until it arrives). */
  const [v2Html, setV2Html] = useState<{ key: string; html: string } | null>(null);
  const [availableCredits, setAvailableCredits] = useState<number | null>(null);
  const [creditCost, setCreditCost] = useState(20);
  const [paidBy, setPaidBy] = useState<"plexo" | "own-key">("plexo");
  const [showPersonalizeModal, setShowPersonalizeModal] = useState(false);
  const [showCreditModal, setShowCreditModal] = useState(false);
  const request = useRef(0);
  const toast = useToast();

  useEffect(() => {
    fetch("/api/onboarding/personalize")
      .then((r) => r.json())
      .then((data) => {
        if (typeof data?.availableCredits === "number") {
          setAvailableCredits(data.availableCredits);
        }
        if (typeof data?.cost === "number") {
          setCreditCost(data.cost);
        }
        if (data?.paidBy) {
          setPaidBy(data.paidBy);
        }
      })
      .catch(() => {});
  }, []);
  // "Your brand": the owner's choice of a Strata project (or "make one from my brand"), sent with the create request.
  const [brandPick, setBrandPick] = useState<PickerSelection>(NO_SELECTION);
  const [picked, setPicked] = useState<PickedBrand | null>(null);
  const [brandStep, setBrandStep] = useState<boolean>(preview?.screen === "brand" ? true : true);
  const note = useMemo(() => limitNote(context.plan, context.liveSiteNames), [context.plan, context.liveSiteNames]);
  // The designs and the new site use the chosen Strata brand's colours and logo (they win over the account's).
  const brand = useMemo(() => {
    const base = context.brand ?? undefined;
    return picked && (picked.colors.length || picked.logoUrl) ? { ...(base ?? {}), ...(picked.colors.length ? { colors: picked.colors } : {}), ...(picked.logoUrl ? { logoUrl: picked.logoUrl } : {}) } : base;
  }, [context.brand, picked]);
  const chosenDesign = designs.find((d) => d.id === designId) ?? designs[0] ?? null;
  // The design as the owner will see it: their name and chosen colour on it from the start, before SOL does anything.
  const brandedHtml = useMemo(
    () => (chosenDesign?.html ? brandPreviewHtml(chosenDesign.html, { name: name.trim(), color: brand?.colors?.[0], designName: chosenDesign.name, about: about.trim() }) : null),
    [chosenDesign?.html, chosenDesign?.name, name, about, brand?.colors],
  );
  // A new-editor design is previewed from its own design data: the server edits the design (name, description, colour, logo) and compiles it with the
  // compiler the editor and publisher use, so the preview is what the editor will hold and what publishes. Until it arrives (or if it can't) the
  // page-text preview above stands in.
  const v2Key = chosenDesign?.v2 ? JSON.stringify([chosenDesign.id, name.trim(), about.trim(), brand?.colors ?? [], brand?.logoUrl ?? ""]) : "";
  useEffect(() => {
    if (!chosenDesign?.v2 || preview?.mock || personalizedHtml) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      fetch("/api/onboarding/personalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: "preview", designId: chosenDesign.id, profile: { goal: goal || "business-site", brand: { ...(brand ?? {}), name: name.trim(), ...(about.trim() ? { about: about.trim().slice(0, 500) } : {}) } } }),
      })
        .then((r) => r.json().catch(() => null))
        .then((data) => { if (alive && typeof data?.html === "string") setV2Html({ key: v2Key, html: data.html }); })
        .catch(() => {});
    }, 300);
    return () => { alive = false; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v2Key, personalizedHtml]);
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

  /** After "what is it for": ask about their brand when Strata is on (it can be skipped), otherwise go straight to the designs. */
  const toBrand = async () => {
    if (!goal) return;
    if (isAppGoal(goal)) {
      onClose?.();
      router.push(appHref(name));
      return;
    }
    if (!name.trim()) return setError("Give your website a name, like your business name.");
    setError("");
    setIsContinuing(true);
    let on = true;
    try {
      const adapter = preview?.strata ?? createStrataAdapter();
      on = await adapter.available();
    } catch {
      on = true;
    }
    setBrandStep(on);
    setTimeout(() => {
      setIsContinuing(false);
      if (on) setScreen("brand");
      else void toLook();
    }, 700);
  };

  const toLook = async (typeOverride?: string) => {
    if (!goal) return;
    if (!name.trim()) return setError("Give your website a name, like your business name.");
    setError("");
    setScreen("look");
    setDesigns([]);
    setLoadingDesigns(true);
    setPersonalizedHtml(null);
    setSolEdits(null);
    setV2Html(null);
    setIsPersonalized(false);
    const id = ++request.current;
    try {
      const res = await fetch("/api/onboarding/market-designs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: {
            goal,
            brand: {
              ...(brand ?? {}),
              name: name.trim(),
              ...(about.trim() ? { about: about.trim().slice(0, 500) } : {}),
              ...((typeOverride ?? typePick) ? { businessType: typeOverride ?? typePick } : {}),
            },
          },
          mock: preview?.mock,
        }),
      });
      const data = await res.json();
      if (id !== request.current) return;
      if (!res.ok) throw new Error(data?.error || "");

      let loadedDesigns = data.designs || [];
      let totalCount = data.total || 0;
      if (!loadedDesigns.length) {
        // Fallback if no marketplace designs are seeded yet
        const fallbackRes = await fetch("/api/onboarding/designs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profile: {
              goal,
              brand: {
                ...(brand ?? {}),
                name: name.trim(),
                ...(about.trim() ? { about: about.trim().slice(0, 500) } : {}),
              },
            },
          }),
        });
        const fallbackData = await fallbackRes.json();
        if (fallbackRes.ok && fallbackData.designs?.length) {
          loadedDesigns = fallbackData.designs;
          totalCount = fallbackData.total;
        }
      }

      setFeel(data.understood ?? null);
      setTypeUsed(data.businessType ?? null);
      setDesigns(loadedDesigns);
      setTotal(totalCount);
      setDesignId(loadedDesigns[0]?.id ?? "");
    } catch {
      if (id === request.current) setError("We couldn't show the designs just now. You can still make your website: we'll pick a good one for you.");
    } finally {
      if (id === request.current) setLoadingDesigns(false);
    }
  };

  /** "Personalize with SOL": confirm what it costs, then SOL Studio opens over the preview and starts. */
  const askToPersonalize = () => {
    if (studioRun !== null) return;
    setShowPersonalizeModal(true);
  };
  const startPersonalizing = () => {
    setShowPersonalizeModal(false);
    if (paidBy !== "own-key" && availableCredits !== null && availableCredits < creditCost) {
      setShowCreditModal(true);
      return;
    }
    setStudioRun((n) => (n ?? 0) + 1);
  };
  /** SOL finished: the preview now shows the personalized design. */
  const personalized = (result: PersonalizeResult) => {
    setPersonalizedHtml(result.html);
    setSolEdits(chosenDesign?.v2 && result.edits ? { designId: chosenDesign.id, edits: result.edits } : null);
    setIsPersonalized(true);
    if (typeof result.creditsRemaining === "number") setAvailableCredits(result.creditsRemaining);
    // Hand the owner straight back to the preview, now showing their words, once they have seen SOL say it is done.
    // (Waiting for a "Back to design" press left them looking at a finished chat while the real result sat hidden.)
    if (backTimer.current) window.clearTimeout(backTimer.current);
    backTimer.current = window.setTimeout(() => {
      setStudioRun(null);
      toast.show({ title: "SOL made your design yours", description: "SOL wrote these headlines for your business. Edit any of them or ask for another version with Rewrite this with SOL.", tone: "success" });
    }, 1400);
  };

  /** Makes the site (from the kit design, or from a marketplace design) and opens it. */
  const make = async (extra: { designId?: string; marketDesignId?: string; /** A new-editor design: SOL's part of it. The server rebuilds the design from the listing; no page HTML is sent for such a design. */ designEdits?: SolEdits; /** The design as the owner saw it: SOL's version, or the one with their name, colour and description on it. */ html?: { personalized?: string; branded?: string } }, who: { goal: NewSiteGoal; name: string }, tries = 1) => {
    setError("");
    setScreen("making");
    const { html: approved, ...design } = extra;
    try {
      if (preview?.mock) { await new Promise((r) => setTimeout(r, 600)); setScreen("look"); return; }
      for (let i = 0; i < tries; i++) {
        const res = await fetch("/api/dashboard/new-site", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            goal: who.goal,
            name: who.name,
            ...design,
            ...(approved?.personalized ? { personalizedHtml: approved.personalized } : {}),
            ...(!approved?.personalized && approved?.branded ? { brandedHtml: approved.branded } : {}),
            ...(brand?.colors?.[0] ? { brandColor: brand.colors[0] } : {}),
            ...(extra.marketDesignId && brand?.logoUrl ? { brandLogoUrl: brand.logoUrl } : {}),
            ...(about.trim() ? { about: about.trim().slice(0, 500) } : {}),
            ...(feel ? { industry: feel.industry, style: feel.style } : {}),
            ...(selectionToChoice(brandPick) ? { brand: selectionToChoice(brandPick) } : {}),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.site) {
          if (data.brand?.ok && data.brand.project?.name) toast.show({ title: `Your "${data.brand.project.name}" brand is on your website`, tone: "success" });
          else if (data.brand && !data.brand.ok && data.brand.message) toast.show({ title: "Your website is ready", description: data.brand.message, tone: "info" });
          try { document.cookie = `${CURRENT_SITE_COOKIE}=${encodeURIComponent(data.site.id)}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`; sessionStorage.removeItem(PENDING_KEY); } catch { /* the server set it too */ }
          // Anything that could not be carried over automatically is told in plain words: now, and again on the dashboard (this page is about
          // to be replaced, so the note waits in the browser for Home to show it until the owner closes it).
          const note = noticeFor(data.site.id, data.warnings);
          if (note) {
            try { sessionStorage.setItem(NEW_SITE_NOTICE_KEY, JSON.stringify(note)); } catch { /* the toast below still says it */ }
            toast.show({ title: "Your website is ready. A few things to check", description: note.messages[0], tone: "info" });
          }
          onClose?.();
          // Always the dashboard: it shows this website's next steps ("Review and edit your pages", "Finish up"), whether or not SOL personalized it.
          router.push(afterCreateHref());
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
  const isKit = ["home-sales", "home-showcase", "home-simple", "home-shop", "home-blog"].includes(designId);
  // What the site is made from is what the owner saw: SOL's version of the design they previewed, or that design with their name,
  // colour and description on it. (SOL's version belongs to the design it was made for, never to another one picked later.)
  const approvedFor = (id: string): { personalized?: string; branded?: string } | undefined =>
    chosenDesign && chosenDesign.id === id ? { ...(personalizedHtml ? { personalized: personalizedHtml } : {}), ...(brandedHtml ? { branded: brandedHtml } : {}) } : undefined;
  const create = () => {
    if (!goal) return undefined;
    const v2 = chosenDesign?.id === designId && chosenDesign.v2 === true;
    return make({ ...(isKit ? { designId } : { marketDesignId: designId, designId }), ...(v2 && solEdits?.designId === designId ? { designEdits: solEdits.edits } : {}), html: v2 ? undefined : approvedFor(designId) }, { goal, name: name.trim() });
  };
  const useMarketDesign = (d: PickerDesign) => {
    if (!goal) return undefined;
    // A new-editor design needs no page HTML: the server builds the site from the design with the owner's name, description, colour and logo.
    if (d.v2) return make({ marketDesignId: d.id, ...(solEdits?.designId === d.id ? { designEdits: solEdits.edits } : {}) }, { goal, name: name.trim() });
    const own = approvedFor(d.id);
    // A design picked from "All designs" gets the same treatment the preview gives: the owner's name, colour and description on it.
    const branded = own ? undefined : d.html ? brandPreviewHtml(d.html, { name: name.trim(), color: brand?.colors?.[0], designName: d.name, about: about.trim() }) : undefined;
    return make({ marketDesignId: d.id, html: own ?? (branded ? { branded } : undefined) }, { goal, name: name.trim() });
  };

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
  // SOL Studio belongs to the "Pick a look" screen: leaving it closes the studio, so coming back never restarts SOL by itself.
  useEffect(() => { if (screen !== "look") setStudioRun(null); }, [screen]);
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
    if (isContinuing) {
      return (
        <OptimisticLoader variant="page"
          stage="finding-designs"
          siteName={name.trim() || "your brand"}
        />
      );
    }
    return (
      <>
        <div className="plx-ns__top">{back("fork")}<p className="plx-ns__step">{stepText("goal", brandStep)}</p></div>
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
        <Textarea
          fieldClassName="plx-ns__about"
          label="Briefly describe what you want your website to look like"
          help="So we pick the best look for you. For example: a warm, friendly bakery in Lagos that takes cake orders. You can skip this."
          value={about}
          rows={3}
          maxLength={500}
          onChange={(e) => setAbout(e.target.value)}
        />
        <Select
          fieldClassName="plx-ns__name"
          label="What kind of business is it?"
          optional
          help="So the designs we show are made for your kind of business. Not sure? Leave it and SOL works it out from what you wrote."
          value={typePick}
          options={[{ value: "", label: typeGuess ? `Auto: looks like ${typeGuess.label}` : "Not sure: let SOL work it out" }, ...typeOptions]}
          onChange={(e) => setTypePick(e.target.value)}
        />
        <div className="plx-ns__actions">
          <span />
          <Button size="lg" disabled={!goal} rightIcon={<ArrowRight size={18} aria-hidden />} onClick={toBrand}>{app ? "Build it with SOL" : "Continue"}</Button>
        </div>
        {!goal ? <p className="plx-ns__other" style={{ marginTop: -12 }}>Pick one to continue</p> : null}
      </>
    );
  }

  if (screen === "brand") {
    return (
      <>
        <div className="plx-ns__top">{back("goal")}<p className="plx-ns__step">{stepText("brand", brandStep)}</p></div>
        {heading("Choose your colours and logo", "Pick a colour palette to start with. You can change these anytime or customize them in your editor.")}
        <BrandStepContent
          client={preview?.strata}
          siteName={name.trim()}
          initialColors={brand?.colors}
          initialLogoUrl={brand?.logoUrl}
          onBrandChange={({ colors: newColors, logoUrl: newLogo, strataSelection }) => {
            setPicked({ projectId: "", name: name.trim(), colors: newColors, logoUrl: newLogo });
            setBrandPick(strataSelection);
          }}
        />
        <div className="plx-ns__actions" style={{ marginTop: 12 }}>
          <span />
          <Button size="lg" rightIcon={<ArrowRight size={18} aria-hidden />} onClick={() => void toLook()}>Continue to designs</Button>
        </div>
      </>
    );
  }

  if (screen === "making") {
    return (
      <OptimisticLoader variant="page"
        stage="making-site"
        siteName={name.trim() || "your website"}
      />
    );
  }

  if (screen === "all" && goal && goal !== "app") {
    return (
      <>
        <div className="plx-ns__top">{back("look")}<p className="plx-ns__step">{stepText("all", brandStep)}</p></div>
        {heading(`All designs for ${name.trim() || "your website"}`, "Made by designers on Plexo, best fit first. Free ones cost nothing; paid ones are a one-time price. Your logo and colours are added to your Brand page.")}
        {error ? <GateOrError error={error}><Notice kind="warning" title="Something went wrong">{error}</Notice></GateOrError> : null}
        <SeeAllDesigns goal={goal} name={name.trim()} brand={brand} extra={{ about: about.trim(), industry: feel?.industry, tone: feel?.style, businessType: typePick || typeUsed?.id }} mock={preview?.mock} onUse={useMarketDesign} />
      </>
    );
  }

  const displayHtml = personalizedHtml ?? (chosenDesign?.v2 && v2Html && v2Html.key === v2Key ? v2Html.html : brandedHtml);

  return (
    <>
      <div className="plx-ns__top">{back(brandStep ? "brand" : "goal")}<p className="plx-ns__step">{stepText("look", brandStep)}</p></div>
      {heading(`Pick a look for ${name.trim() || "your website"}`, "Tailored to your brand and goals. Preview on desktop or mobile, make it yours with SOL, or explore all designs.")}
      {error ? <GateOrError error={error}><Notice kind="warning" title="Something went wrong">{error}</Notice></GateOrError> : null}
      {typeUsed && !loadingDesigns ? (
        <div className="plx-ns__kind">
          <Select
            hideLabel
            label="Kind of business"
            value={typePick || typeUsed.id}
            options={typeOptions}
            onChange={(e) => { setTypePick(e.target.value); void toLook(e.target.value); }}
          />
          <span className="plx-ns__kindhelp">Designs for this kind of business. Not right? Pick another.</span>
        </div>
      ) : null}

      <HeroDesignPreview
        html={displayHtml}
        designName={chosenDesign?.name ?? (loadingDesigns ? "Loading design…" : "Website Design")}
        designDescription={chosenDesign?.description}
        siteName={name.trim()}
        onPersonalize={askToPersonalize}
        studio={
          studioRun !== null && (chosenDesign?.html || chosenDesign?.v2) ? (
            <PersonalizeStudio
              key={studioRun}
              profile={{ goal: goal || "business-site", brand: { ...(brand ?? {}), name: name.trim(), ...(about.trim() ? { about: about.trim().slice(0, 500) } : {}) } }}
              design={{ id: chosenDesign.id, name: chosenDesign.name, description: chosenDesign.description, html: brandedHtml ?? chosenDesign.html ?? "", v2: chosenDesign.v2 }}
              creditCost={creditCost}
              onApplied={personalized}
              onClose={() => setStudioRun(null)}
            />
          ) : null
        }
        personalized={isPersonalized}
        onSeeAll={() => { setError(""); setScreen("all"); }}
        totalDesigns={total || designs.length}
      />

      <SolPersonalizeModal
        open={showPersonalizeModal}
        onClose={() => setShowPersonalizeModal(false)}
        brandName={name.trim() || "Your Brand"}
        availableCredits={availableCredits}
        creditCost={creditCost}
        paidBy={paidBy}
        onProceed={startPersonalizing}
        onTopup={() => {
          setShowPersonalizeModal(false);
          setShowCreditModal(true);
        }}
      />

      {showCreditModal && (
        <CreditModal
          creditInfo={{ requiredCredits: creditCost, availableCredits: availableCredits ?? 0 }}
          returnTo={typeof window !== "undefined" ? window.location.href : "/dashboard"}
          onClose={() => {
            setShowCreditModal(false);
            fetch("/api/onboarding/personalize")
              .then((r) => r.json())
              .then((d) => {
                if (typeof d?.availableCredits === "number") setAvailableCredits(d.availableCredits);
                if (typeof d?.cost === "number") setCreditCost(d.cost);
                if (d?.paidBy) setPaidBy(d.paidBy);
              })
              .catch(() => {});
          }}
        />
      )}

      {note ? (
        <Notice kind="info" title="Good to know" action={{ label: note.upgradeLabel, href: note.upgradeHref }}>{note.text}</Notice>
      ) : null}
      <div className="plx-ns__actions">
        <Button variant="ghost" onClick={() => { setError(""); setScreen("all"); }}>{total > 1 ? `See all designs (${total})` : "See all designs"}</Button>
        <Button size="lg" disabled={loadingDesigns || studioRun !== null} rightIcon={<ArrowRight size={18} aria-hidden />} onClick={create}>Create my website</Button>
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
