"use client";

import "./onboarding.css";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Button, Stepper, StatusPill, Avatar, Textarea, useToast } from "@/app/dashboard/_v3/ui";
import { PlexoLogo } from "@/app/dashboard/_v3/brand/PlexoLogo";
import type { SolBuildGoal, SolBuildProfile, SolExperience } from "@/lib/ai/solBuildContext";
import type { SiteSummary } from "@/lib/dashboardV3/sites";
import { EXPERIENCES, GOALS } from "@/lib/onboarding/flow";
import { CURRENT_SITE_COOKIE, TUNE_ACTIONS, defaultTuneSite, tuneSolHref, type TuneActionId } from "@/lib/onboarding/tune";
import { ContinueLaterButton } from "./ContinueLater";

const THUMB_W = 1280;

/** What the site really looks like, shrunk to fit. The owner's own initials show underneath until it loads (or if there is nothing to show yet). */
function SiteThumb({ site, mock }: { site: SiteSummary; mock: boolean }) {
  const box = useRef<HTMLSpanElement>(null);
  const [scale, setScale] = useState(0.25);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / THUMB_W);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Apps are previewed in their own builder, not as a page.
  const showFrame = !mock && site.kind !== "App with sign-in";
  return (
    <span className="ob-site__thumb" ref={box} aria-hidden>
      <span className="ob-site__fallback"><Avatar name={site.name} size={56} square /></span>
      {showFrame ? (
        <iframe className="ob-site__shot" src={`/api/v1/templates/${site.id}/draft-preview?thumb=1`} title="" tabIndex={-1} loading="lazy" referrerPolicy="no-referrer" style={{ width: THUMB_W, height: Math.round((THUMB_W * 10) / 16), transform: `scale(${scale})` }} />
      ) : null}
    </span>
  );
}

/** "Let's tune Plexo to you": for owners who already have sites. Nothing is created and no design is picked. */
export function TuneWizard({ initialProfile, sites, currentSiteId, mock = false }: { initialProfile?: SolBuildProfile; sites: SiteSummary[]; currentSiteId?: string | null; mock?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const several = sites.length > 1;
  const stepCount = several ? 3 : 2;
  const [step, setStep] = useState(0);
  const [experience, setExperience] = useState<SolExperience | "">(initialProfile?.experience ?? "");
  const [goal, setGoal] = useState<SolBuildGoal | "">(initialProfile?.goal ?? "");
  const [siteId, setSiteId] = useState(() => defaultTuneSite(sites, currentSiteId)?.id ?? "");
  const [action, setAction] = useState<TuneActionId | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const site = sites.find((s) => s.id === siteId) ?? sites[0];
  const last = step === stepCount - 1;
  const stepKind = step === 0 ? "you" : several && step === 1 ? "site" : "do";

  const saveYou = async () => {
    setBusy(true);
    if (!mock) {
      const profile: SolBuildProfile = { ...initialProfile, experience: experience as SolExperience, ...(goal ? { goal } : {}) };
      const res = await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ buildProfile: profile, onboardingComplete: true }) }).catch(() => null);
      if (!res?.ok) {
        setBusy(false);
        toast.show({ tone: "danger", title: "We couldn't save that", description: "Check your internet connection and try again." });
        return;
      }
    }
    setBusy(false);
    setStep(1);
    window.scrollTo({ top: 0 });
  };

  const open = () => {
    if (!site) return;
    document.cookie = `${CURRENT_SITE_COOKIE}=${encodeURIComponent(site.id)}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
    if (mock) return;
    router.push(action === "around" ? "/dashboard" : tuneSolHref(site, action, note));
  };

  const back = <Button variant="secondary" size="lg" leftIcon={<ArrowLeft size={18} aria-hidden />} onClick={() => setStep(step - 1)}>Back</Button>;

  return (
    <div className="ob-page">
      <header className="ob-header">
        <PlexoLogo height={26} />
        <div className="ob-header__progress"><Stepper total={stepCount} current={step} /></div>
        {mock ? <span /> : <ContinueLaterButton />}
      </header>
      <main className="ob-main">
        <div className={`ob-col${stepKind === "site" ? " ob-col--wide" : ""}`}>
          {stepKind === "you" ? (
            <div className="ob-stack">
              <div>
                <p className="ob-eyebrow">Welcome back</p>
                <h1 className="ob-title">Let&apos;s tune Plexo to you</h1>
                <p className="ob-lead">Two quick answers, and your dashboard shows just what you need. You already have {sites.length === 1 ? "a site" : `${sites.length} sites`}, so there&apos;s nothing to set up.</p>
              </div>
              <div className="ob-group">
                <span className="ob-label" id="tune-exp">How much have you built before?</span>
                <div className="ob-choices ob-choices--one" role="radiogroup" aria-labelledby="tune-exp">
                  {EXPERIENCES.map((e) => (
                    <button key={e.id} type="button" role="radio" aria-checked={experience === e.id} className="ob-choice" onClick={() => setExperience(e.id)}>
                      <span className="ob-choice__title">{e.title}</span>
                      <span className="ob-choice__text">{e.text}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="ob-group">
                <span className="ob-label" id="tune-goal">What will you mainly do next? <span className="ob-sub">Optional</span></span>
                <div className="ob-ideas" role="radiogroup" aria-labelledby="tune-goal">
                  {GOALS.map((g) => (
                    <button key={g.id} type="button" role="radio" aria-checked={goal === g.id} className="ob-chip" onClick={() => setGoal(goal === g.id ? "" : g.id)}>{g.title}</button>
                  ))}
                </div>
              </div>
              <div className="ob-actions">
                <Button size="lg" disabled={!experience} loading={busy} rightIcon={<ArrowRight size={18} aria-hidden />} onClick={saveYou}>Continue</Button>
                {!experience ? <span className="ob-actions__hint">Pick one to continue</span> : null}
              </div>
            </div>
          ) : stepKind === "site" ? (
            <div className="ob-stack">
              <div>
                <h1 className="ob-title">Which site do you want to work on first?</h1>
                <p className="ob-lead">We picked the one you edited most recently. Tap another if you&apos;d rather.</p>
              </div>
              <div className="ob-sites" role="radiogroup" aria-label="Your sites">
                {sites.slice(0, 12).map((s) => (
                  <button key={s.id} type="button" role="radio" aria-checked={siteId === s.id} className="ob-site" onClick={() => setSiteId(s.id)}>
                    <SiteThumb site={s} mock={mock} />
                    <span className="ob-site__meta">
                      <span className="ob-site__name" title={s.name}>{s.name}</span>
                      <span className="plx-small">{s.kind}</span>
                      <span><StatusPill status={s.status} label={s.status === "live" ? "Online" : "Not online yet"} /></span>
                    </span>
                    {siteId === s.id ? <span className="ob-site__check" aria-hidden><Check size={16} /></span> : null}
                  </button>
                ))}
              </div>
              {sites.length > 12 ? <p className="ob-sub">Showing your 12 most recent sites. You can switch to any other later.</p> : null}
              <div className="ob-actions">{back}<Button size="lg" disabled={!site} rightIcon={<ArrowRight size={18} aria-hidden />} onClick={() => setStep(step + 1)}>Continue</Button></div>
            </div>
          ) : (
            <div className="ob-stack">
              <div>
                <h1 className="ob-title">What would you like to do with {site ? <>&ldquo;{site.name}&rdquo;</> : "it"}?</h1>
                <p className="ob-lead">SOL is Plexo&apos;s assistant. It looks at your site first, then makes the change with you.</p>
              </div>
              <div className="ob-choices" role="radiogroup" aria-label="What to do">
                {TUNE_ACTIONS.map((a) => (
                  <button key={a.id} type="button" role="radio" aria-checked={action === a.id} className="ob-choice" onClick={() => setAction(action === a.id ? "" : a.id)}>
                    <span className="ob-choice__title">{a.title}</span>
                    <span className="ob-choice__text">{a.text}</span>
                  </button>
                ))}
              </div>
              {action !== "around" ? (
                <Textarea label="Tell SOL what to change" optional placeholder="For example: make the homepage warmer and add my WhatsApp number." value={note} onChange={(e) => setNote(e.target.value)} maxLength={600} />
              ) : null}
              <div className="ob-actions">
                {several ? back : null}
                <Button size="lg" rightIcon={<ArrowRight size={18} aria-hidden />} onClick={open}>{action === "around" ? "Go to my dashboard" : "Open it with SOL"}</Button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
