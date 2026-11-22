"use client";

import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import "./newsite.css";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, FilePlus2, Truck } from "lucide-react";
import { Button, ButtonLink, Input, Modal, Notice, OptimisticLoader, Textarea, useToast } from "../ui";
import { type PickedBrand, type StrataPickerClient } from "../brand/StrataBrandPicker";
import { NO_SELECTION, selectionToChoice, type PickerSelection } from "@/lib/dashboardV3/strataPicker";
import { createStrataAdapter } from "@/app/dashboard/apps/_components/strataAdapter";
import { CURRENT_SITE_COOKIE } from "@/lib/dashboardV3/sites";
import { siteHubHref } from "@/lib/dashboardV3/hubPaths";
import {
  afterFork, appHref, paidDesignFrom, PAID_RETRY, PENDING_KEY, readPending, defaultSiteName, isAppGoal, limitNote, MORE_WAYS, NEW_SITE_GOALS, OTHER_EDITOR_HREF, STARTS,
  type NewSiteGoal, type Start,
} from "@/lib/dashboardV3/newSite";
import type { SolBuildProfile } from "@/lib/ai/solBuildContext";
import { SeeAllDesigns } from "./SeeAllDesigns";
import { HeroDesignPreview } from "./HeroDesignPreview";
import { BrandStepContent } from "./BrandStepContent";
import type { PickerDesign } from "../designs/DesignPicker";
import { CreditModal } from "../sol/CreditModal";
import { SolPersonalizeModal } from "./SolPersonalizeModal";

export type NewSiteContext = {
  plan: string;
  /** The owner's saved brand: its name is the suggested site name and its colours/logo are used for the designs. */
  brand: SolBuildProfile["brand"] | null;
  siteNames: string[];
  liveSiteNames: string[];
};

type Screen = "fork" | "goal" | "brand" | "look" | "all" | "making";
type Design = { id: string; name: string; description: string; html?: string };

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
  const [designId, setDesignId] = useState("");
  const [error, setError] = useState("");
  const [loadingDesigns, setLoadingDesigns] = useState(false);
  const [isContinuing, setIsContinuing] = useState(false);
  const [isPersonalizing, setIsPersonalizing] = useState(false);
  const [isPersonalized, setIsPersonalized] = useState(false);
  const [personalizedHtml, setPersonalizedHtml] = useState<string | null>(null);
  const [availableCredits, setAvailableCredits] = useState<number | null>(null);
  const [creditCost, setCreditCost] = useState(1);
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

  const toLook = async () => {
    if (!goal) return;
    if (!name.trim()) return setError("Give your website a name, like your business name.");
    setError("");
    setScreen("look");
    setDesigns([]);
    setLoadingDesigns(true);
    setPersonalizedHtml(null);
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
      setDesigns(loadedDesigns);
      setTotal(totalCount);
      setDesignId(loadedDesigns[0]?.id ?? "");
    } catch {
      if (id === request.current) setError("We couldn't show the designs just now. You can still make your website: we'll pick a good one for you.");
    } finally {
      if (id === request.current) setLoadingDesigns(false);
    }
  };

  /** Personalizes the currently displayed design with SOL based on name, about, and goal */
  const personalizeWithSol = async () => {
    if (!goal || isPersonalizing) return;
    if (paidBy !== "own-key" && availableCredits !== null && availableCredits < creditCost) {
      setShowCreditModal(true);
      return;
    }
    setIsPersonalizing(true);
    const chosen = designs.find((d) => d.id === designId) ?? designs[0] ?? null;
    try {
      const res = await fetch("/api/onboarding/personalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: { goal, brand: { ...(brand ?? {}), name: name.trim(), ...(about.trim() ? { about: about.trim().slice(0, 500) } : {}) } },
          designId,
          templateHtml: chosen?.html ?? undefined,
          templateName: chosen?.name ?? undefined,
          templateDescription: chosen?.description ?? undefined,
        }),
      });
      const text = await res.text();
      let data: Record<string, unknown> | null = null;
      try {
        data = JSON.parse(text);
      } catch {
        // Response was not JSON (e.g. gateway timeout or HTML)
      }
      if (res.status === 402 || data?.outOfCredits) {
        if (typeof data?.availableCredits === "number") setAvailableCredits(data.availableCredits);
        setShowCreditModal(true);
        return;
      }
      if (!res.ok || !data) {
        throw new Error((data?.error as string) || "SOL encountered a temporary delay while personalizing. Please try again.");
      }
      if (typeof data.html === "string" && data.html) {
        setPersonalizedHtml(data.html);
        setIsPersonalized(true);
        if (typeof data.creditsRemaining === "number") {
          setAvailableCredits(data.creditsRemaining);
        }
        toast.show({
          title: "Template personalized with SOL",
          description: (data.summary as string) || `Headlines, copy, and images tailored to "${name.trim()}".`,
          tone: "success",
        });
      }
    } catch (err) {
      toast.show({
        title: "Could not personalize template",
        description: err instanceof Error ? err.message : "Please try again.",
        tone: "info",
      });
    } finally {
      setIsPersonalizing(false);
    }
  };

  /** Makes the site (from the kit design, or from a marketplace design) and opens it. */
  const make = async (extra: { designId?: string; marketDesignId?: string }, who: { goal: NewSiteGoal; name: string }, tries = 1) => {
    setError("");
    setScreen("making");
    try {
      if (preview?.mock) { await new Promise((r) => setTimeout(r, 600)); setScreen("look"); return; }
      for (let i = 0; i < tries; i++) {
        const res = await fetch("/api/dashboard/new-site", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            goal: who.goal,
            name: who.name,
            ...extra,
            ...(personalizedHtml ? { personalizedHtml } : {}),
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
  const isKit = ["home-sales", "home-showcase", "home-simple", "home-shop", "home-blog"].includes(designId);
  const create = () => (goal ? make(isKit ? { designId } : { marketDesignId: designId, designId }, { goal, name: name.trim() }) : undefined);
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
    if (isContinuing) {
      return (
        <OptimisticLoader
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
          <Button size="lg" rightIcon={<ArrowRight size={18} aria-hidden />} onClick={toLook}>Continue to designs</Button>
        </div>
      </>
    );
  }

  if (screen === "making") {
    return (
      <OptimisticLoader
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
        <SeeAllDesigns goal={goal} name={name.trim()} brand={brand} extra={{ about: about.trim(), industry: feel?.industry, tone: feel?.style }} mock={preview?.mock} onUse={useMarketDesign} />
      </>
    );
  }

  const chosenDesign = designs.find((d) => d.id === designId) ?? designs[0] ?? null;
  const displayHtml = personalizedHtml ?? chosenDesign?.html ?? null;

  return (
    <>
      <div className="plx-ns__top">{back(brandStep ? "brand" : "goal")}<p className="plx-ns__step">{stepText("look", brandStep)}</p></div>
      {heading(`Pick a look for ${name.trim() || "your website"}`, "Tailored to your brand and goals. Preview on desktop or mobile, personalize with SOL, or explore all designs.")}
      {error ? <GateOrError error={error}><Notice kind="warning" title="Something went wrong">{error}</Notice></GateOrError> : null}

      <HeroDesignPreview
        html={displayHtml}
        designName={chosenDesign?.name ?? (loadingDesigns ? "Loading design…" : "Website Design")}
        designDescription={chosenDesign?.description}
        siteName={name.trim()}
        onPersonalize={() => setShowPersonalizeModal(true)}
        isPersonalizing={isPersonalizing}
        personalized={isPersonalized}
        onSeeAll={() => { setError(""); setScreen("all"); }}
        totalDesigns={total || designs.length}
        availableCredits={availableCredits}
        creditCost={creditCost}
      />

      <SolPersonalizeModal
        open={showPersonalizeModal}
        onClose={() => setShowPersonalizeModal(false)}
        brandName={name.trim() || "Your Brand"}
        availableCredits={availableCredits}
        creditCost={creditCost}
        paidBy={paidBy}
        onProceed={() => {
          setShowPersonalizeModal(false);
          void personalizeWithSol();
        }}
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
