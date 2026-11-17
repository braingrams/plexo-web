"use client";

import "./onboarding.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, ImagePlus, Palette } from "lucide-react";
import { Button, Input, Stepper, useToast } from "@/app/dashboard/_v3/ui";
import { PlexoLogo } from "@/app/dashboard/_v3/brand/PlexoLogo";
import { createStrataAdapter } from "@/app/dashboard/apps/_components/strataAdapter";
import { dominantColors } from "@/lib/onboarding/logoColors";
import type { SolBuildProfile } from "@/lib/ai/solBuildContext";
import {
  ABOUT_IDEAS, EXPERIENCES, FEELS, GOALS, HEX, PALETTE, PREVIEW_FROM_STEP, STEP_COUNT, EMPTY_DRAFT,
  canContinue, draftFromBuildProfile, draftToBuildProfile, goalMakesSite, resumeStep, waitingHint, type OnboardingDraft,
} from "@/lib/onboarding/flow";
import { ContinueLaterButton } from "./ContinueLater";
import { ScaledFrame } from "./ScaledFrame";
import { DesignPicker, type PickerDesign } from "@/app/dashboard/_v3/designs/DesignPicker";

type Design = { id: string; name: string; description: string; html?: string };
type Done = { siteName: string | null; kind: "site" | "personalised" | "app"; siteId?: string };

async function post<T>(url: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: typeof data?.error === "string" ? data.error : "Something went wrong. Please try again." };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "We couldn't reach Plexo. Check your internet connection and try again." };
  }
}

/** The designs for the current answers (the first one is also the live preview). Waits a moment after each change. */
function useDesigns(profile: SolBuildProfile, enabled: boolean, mock: boolean) {
  const [state, setState] = useState<{ designs: Design[]; others: Design[]; total: number; loading: boolean; error: string }>({ designs: [], others: [], total: 0, loading: false, error: "" });
  const key = JSON.stringify(profile);
  const lastKey = useRef("");
  useEffect(() => {
    if (!enabled || key === lastKey.current) return;
    setState((s) => ({ ...s, loading: true, error: "" }));
    const t = setTimeout(async () => {
      const r = await post<{ designs: Design[]; others: Design[]; total: number }>("/api/onboarding/designs", { profile: JSON.parse(key), mock });
      if (r.ok) {
        lastKey.current = key;
        setState({ designs: r.data.designs, others: r.data.others ?? [], total: r.data.total, loading: false, error: "" });
      } else setState((s) => ({ ...s, loading: false, error: r.error }));
    }, 450);
    return () => clearTimeout(t);
  }, [key, enabled, mock]);
  return state;
}

function Choice({ title, text, selected, onSelect }: { title: string; text: string; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={selected} className="ob-choice" onClick={onSelect}>
      <span className="ob-choice__title">{title}</span>
      <span className="ob-choice__text">{text}</span>
    </button>
  );
}

export function Wizard({ userId, initialProfile, hasSites, mock = false }: { userId: string; initialProfile?: SolBuildProfile; hasSites: boolean; mock?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const storeKey = `plexo-onboarding-v3:${userId}`;
  const [draft, setDraft] = useState<OnboardingDraft>(() => draftFromBuildProfile(initialProfile));
  const [step, setStep] = useState<number>(() => resumeStep(draftFromBuildProfile(initialProfile)));
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Done | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [paying, setPaying] = useState(false);
  const [strata, setStrata] = useState<"idle" | "connecting" | "connected">("idle");
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoPreview, setLogoPreview] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Pick up where they left off (this browser's saved step and answers beat the server copy: they're newer).
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storeKey) ?? "null") as { step?: number; draft?: Partial<OnboardingDraft> } | null;
      if (saved?.draft) {
        const merged = { ...draftFromBuildProfile(initialProfile), ...saved.draft };
        setDraft(merged);
        const limit = resumeStep(merged) < PREVIEW_FROM_STEP ? resumeStep(merged) : STEP_COUNT - 1;
        setStep(Math.min(Math.max(saved.step ?? 0, 0), limit));
      }
    } catch { /* private mode: they just start from the saved answers */ }
    setReady(true);
  }, [storeKey, initialProfile]);
  useEffect(() => {
    if (!ready || done) return;
    try { localStorage.setItem(storeKey, JSON.stringify({ step, draft })); } catch { /* fine */ }
  }, [ready, done, step, draft, storeKey]);

  const set = useCallback(<K extends keyof OnboardingDraft>(k: K, v: OnboardingDraft[K]) => setDraft((d) => ({ ...d, [k]: v })), []);
  const profile = useMemo(() => draftToBuildProfile(draft), [draft]);
  const designProfile = useMemo(() => (profile.goal ? profile : { ...profile, goal: "business-site" as const }), [profile]);
  const makesSite = goalMakesSite(draft.goal);
  const designs = useDesigns(designProfile, ready && step >= PREVIEW_FROM_STEP && (makesSite || step === 3), mock);
  const chosen = designs.designs.find((d) => d.id === draft.designId) ?? designs.designs[0];

  const saveProgress = (d: OnboardingDraft) => {
    if (mock) return;
    // Each answer is saved as they go, so SOL already knows them and a refresh loses nothing.
    void fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ buildProfile: draftToBuildProfile(d) }) }).catch(() => undefined);
  };
  const go = (next: number) => { setError(""); setStep(next); if (typeof window !== "undefined") window.scrollTo({ top: 0 }); };
  const next = () => { if (!canContinue(step, draft)) return; saveProgress(draft); go(Math.min(step + 1, STEP_COUNT - 1)); };

  const onLogo = async (file: File) => {
    setLogoBusy(true);
    setError("");
    try {
      const bmp = await createImageBitmap(file).catch(() => null);
      if (bmp) {
        const c = document.createElement("canvas");
        c.width = c.height = 64;
        const ctx = c.getContext("2d");
        ctx?.drawImage(bmp, 0, 0, 64, 64);
        const colors = ctx ? dominantColors(ctx.getImageData(0, 0, 64, 64).data) : [];
        setDraft((d) => ({ ...d, suggested: colors, color: colors[0] ?? d.color }));
      }
      setLogoPreview(URL.createObjectURL(file));
      if (!mock) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/v1/media/upload", { method: "POST", body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.url) throw new Error(typeof data?.error === "string" ? data.error : "");
        setDraft((d) => ({ ...d, logoUrl: data.url as string }));
      }
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "We couldn't upload that logo. Try a PNG, JPG or SVG under 8 MB, or skip it for now.");
    } finally {
      setLogoBusy(false);
    }
  };

  const connectStrata = async () => {
    setStrata("connecting");
    try {
      await createStrataAdapter().connect();
      setStrata("connected");
    } catch (e) {
      setStrata("idle");
      toast.show({ tone: "danger", title: "Strata wasn't connected", description: e instanceof Error ? e.message : "Please try again in a moment." });
    }
  };

  /** Makes the site from a real marketplace design. A just-paid design can take a moment to be recorded, so we ask again briefly. */
  const startFromMarketDesign = useCallback(async (d: PickerDesign, tries = 1): Promise<void> => {
    if (mock) { setDone({ siteName: draft.name, kind: "site" }); return; }
    for (let i = 0; i < tries; i++) {
      const r = await fetch("/api/onboarding/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile, marketDesignId: d.id }) });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.site) {
        try { localStorage.removeItem(storeKey); } catch { /* fine */ }
        setDone({ siteName: data.site.name, kind: "site", siteId: data.site.id });
        router.push(`/dashboard/sites/${data.site.id}`);
        return;
      }
      if (data?.needsPurchase && i < tries - 1) { await new Promise((res) => setTimeout(res, 2000)); continue; }
      throw new Error(typeof data?.error === "string" ? data.error : "We couldn't make your site just now. Nothing was lost: please try again in a moment.");
    }
  }, [mock, draft.name, profile, storeKey, router]);

  // Coming back from paying for a design in the card window: finish making the site from it.
  const resumed = useRef(false);
  useEffect(() => {
    if (!ready || mock || resumed.current || typeof window === "undefined") return;
    const paid = new URLSearchParams(window.location.search).get("paidDesign");
    if (!paid) return;
    resumed.current = true;
    setPaying(true);
    startFromMarketDesign({ id: paid } as PickerDesign, 8).catch((e) => { setPaying(false); setShowAll(true); setError(e instanceof Error ? e.message : "We couldn't make your site just now. Please try again."); });
  }, [ready, mock, startFromMarketDesign]);

  const finish = async (skipSite: boolean) => {
    setBusy(true);
    setError("");
    const designId = draft.designId || designs.designs[0]?.id || "";
    if (mock) { setDone({ siteName: draft.name, kind: skipSite ? "personalised" : "site" }); setBusy(false); return; }
    const r = await post<{ site: { name: string } | null }>("/api/onboarding/complete", { profile, designId, skipSite });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    try { localStorage.removeItem(storeKey); } catch { /* fine */ }
    setDone({ siteName: r.data.site?.name ?? null, kind: r.data.site ? "site" : draft.goal === "app" ? "app" : "personalised" });
  };

  const searchNew = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "1";
  const personalising = hasSites;
  const name = draft.name.trim();

  if (paying && !done) {
    return (
      <div className="ob-page">
        <header className="ob-header"><PlexoLogo height={26} /><span /><span /></header>
        <main className="ob-main"><div className="ob-done"><h1 className="ob-title">Making your site…</h1><p className="ob-lead">Thank you. We are confirming your payment and building your site from the design you chose. This takes a few seconds.</p></div></main>
      </div>
    );
  }

  if (done) {
    return (
      <div className="ob-page">
        <header className="ob-header">
          <PlexoLogo height={26} />
          <span />
          <span />
        </header>
        <main className="ob-main">
          <div className="ob-done">
            <span className="ob-done__badge"><Check size={32} aria-hidden /></span>
            <h1 className="ob-title">{done.kind === "site" ? `${done.siteName ?? "Your website"} is ready` : done.kind === "app" ? "You're all set" : "Plexo is set up for you"}</h1>
            <p className="ob-lead">
              {done.kind === "site"
                ? "We built it with your name, colours and words. For now it's a draft that only you can see. Your dashboard walks you through choosing its web address and putting it live."
                : done.kind === "app"
                  ? "Next, tell Sol what your app should do and it builds it with you, sign-in included."
                  : "Your dashboard now shows what matters for what you're making."}
            </p>
            <Button size="lg" rightIcon={<ArrowRight size={18} aria-hidden />} onClick={() => router.push(done.kind === "app" ? "/dashboard/sol" : done.siteId ? `/dashboard/sites/${done.siteId}` : "/dashboard")}>
              {done.kind === "app" ? "Talk to Sol" : "Go to my dashboard"}
            </Button>
          </div>
        </main>
      </div>
    );
  }

  const actions = (primary: React.ReactNode) => (
    <div className="ob-actions">
      {step > 0 ? <Button variant="secondary" size="lg" leftIcon={<ArrowLeft size={18} aria-hidden />} onClick={() => go(step - 1)}>Back</Button> : null}
      {primary}
      {step < 3 ? <span className="ob-actions__hint">{waitingHint(step, draft) || (step === 0 ? "Takes about a minute" : step === 2 ? "You can switch any time in Settings" : "")}</span> : null}
    </div>
  );

  const continueBtn = (label = "Continue") => (
    <Button size="lg" disabled={!canContinue(step, draft)} onClick={next}>{label}</Button>
  );

  const stepForm =
    step === 0 ? (
      <div className="ob-col">
        <div>
          <p className="ob-eyebrow">{personalising ? "Welcome back" : "Welcome to Plexo"}</p>
          <h1 className="ob-title">{personalising ? "Let's personalise Plexo" : "Let's make your website"}</h1>
          <p className="ob-lead">Two quick questions about you. It takes about a minute.</p>
        </div>
        <div className="ob-stack">
          <Input label="What's your brand or business called?" placeholder="e.g. Ama's Kitchen" value={draft.name} maxLength={80} autoFocus autoComplete="organization" onChange={(e) => set("name", e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") next(); }} />
          <Input label="What do you do, in one sentence?" placeholder="e.g. I sell homemade meals in Lagos" value={draft.about} maxLength={200} onChange={(e) => set("about", e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") next(); }} />
          <div className="ob-ideas">
            <span className="ob-ideas__hint">Not sure? Tap one:</span>
            {ABOUT_IDEAS.map((t) => <button key={t} type="button" className="ob-chip" onClick={() => set("about", t)}>{t}</button>)}
          </div>
        </div>
        {actions(continueBtn())}
      </div>
    ) : step === 1 ? (
      <div className="ob-col">
        <div>
          <h1 className="ob-title">What do you want to make first?</h1>
          <p className="ob-lead">Pick the closest one. You can add more later.</p>
        </div>
        <div className="ob-choices" role="radiogroup" aria-label="What you want to make">
          {GOALS.map((g) => <Choice key={g.id} title={g.title} text={g.text} selected={draft.goal === g.id} onSelect={() => set("goal", g.id)} />)}
        </div>
        {actions(continueBtn())}
      </div>
    ) : step === 2 ? (
      <div className="ob-col">
        <div>
          <h1 className="ob-title">Have you made a website before?</h1>
          <p className="ob-lead">So we show you just what you need, nothing more.</p>
        </div>
        <div className="ob-choices ob-choices--one" role="radiogroup" aria-label="Your experience">
          {EXPERIENCES.map((x) => <Choice key={x.id} title={x.title} text={x.text} selected={draft.experience === x.id} onSelect={() => set("experience", x.id)} />)}
        </div>
        {actions(continueBtn())}
      </div>
    ) : step === 3 ? (
      <div className="ob-split">
        <div className="ob-split__form">
          <div>
            <h1 className="ob-title">Make it look like you</h1>
            <p className="ob-lead">Watch your site change as you choose.</p>
          </div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="plx-sr-only" tabIndex={-1} onChange={(e) => { const f = e.target.files?.[0]; if (f) void onLogo(f); e.target.value = ""; }} />
          <button type="button" className="ob-logo" onClick={() => fileRef.current?.click()} disabled={logoBusy}>
            <span className="ob-logo__tile">{logoPreview || draft.logoUrl ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={logoPreview || draft.logoUrl} alt="Your logo" /> : <ImagePlus size={26} aria-hidden />}</span>
            <span className="ob-logo__text">
              <span className="ob-logo__title">{logoBusy ? "Adding your logo…" : logoPreview || draft.logoUrl ? "Change your logo" : "Add your logo (optional)"}</span>
              <span className="ob-logo__sub">We&apos;ll pick matching colours from it. No logo? We&apos;ll make a simple one from your name.</span>
            </span>
          </button>
          <div className="ob-group" role="radiogroup" aria-label="Your main colour">
            <span className="ob-label">Your main colour</span>
            <div className="ob-swatches">
              {[...draft.suggested.map((hex) => ({ hex, name: "From your logo" })), ...PALETTE.filter((p) => !draft.suggested.includes(p.hex))].map((p) => (
                <button key={p.hex} type="button" role="radio" aria-checked={draft.color.toUpperCase() === p.hex} aria-label={`${p.name} ${p.hex}`} title={p.name} className="ob-swatch" style={{ background: p.hex }} onClick={() => set("color", p.hex)} />
              ))}
              {draft.color && !PALETTE.some((p) => p.hex === draft.color.toUpperCase()) && !draft.suggested.some((c) => c === draft.color.toUpperCase()) ? (
                <button type="button" role="radio" aria-checked aria-label={`Your colour ${draft.color}`} className="ob-swatch" style={{ background: draft.color }} />
              ) : null}
              <label className="ob-swatch ob-swatch--custom" title="Pick any colour">
                <Palette size={20} aria-hidden />
                <span className="plx-sr-only">Pick any other colour</span>
                <input type="color" value={HEX.test(draft.color) ? draft.color : "#1F6FEB"} onChange={(e) => set("color", e.target.value.toUpperCase())} />
              </label>
            </div>
            <span className="ob-sub">{draft.suggested.length ? "The first ones come from your logo." : "Not sure? Leave it and we'll pick colours that suit your business."}</span>
          </div>
          <div className="ob-group" role="radiogroup" aria-label="How it should feel">
            <span className="ob-label">How should it feel?</span>
            <div className="ob-ideas">
              {FEELS.map((f) => <button key={f.id} type="button" role="radio" aria-checked={draft.feel === f.id} className="ob-chip" onClick={() => set("feel", f.id)}>{f.label}</button>)}
            </div>
          </div>
          <p className="ob-sub" style={{ fontSize: 15 }}>
            {strata === "connected" ? "Strata is connected. Your site will follow the brand you publish there." : <>Already keep your brand in Strata? <button type="button" className="ob-linkbtn" onClick={connectStrata} disabled={strata === "connecting"}>{strata === "connecting" ? "Connecting…" : "Connect Strata"}</button> and your site will follow every change you publish there.</>}
          </p>
          {error ? <p className="ob-error" role="alert">{error}</p> : null}
          {actions(<Button size="lg" onClick={next}>{makesSite ? "Show me designs" : "Continue"}</Button>)}
        </div>
        <aside className="ob-split__preview" aria-label="Your site, live as you answer">
          <div className="ob-previewhead"><span>Your site, live as you answer</span></div>
          <div className="ob-browser">
            <div className="ob-browser__bar"><span className="ob-browser__dot" /><span className="ob-browser__dot" /><span className="ob-browser__dot" /><span className="ob-browser__addr">{(name || "your-site").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "your-site"}.plexo.site</span></div>
            <ScaledFrame html={designs.designs[0]?.html ?? null} title="Preview of your site" aspect="1 / 1" />
          </div>
        </aside>
      </div>
    ) : !makesSite ? (
      <div className="ob-col">
        <div>
          <h1 className="ob-title">Apps are built with Sol</h1>
          <p className="ob-lead">Sol is Plexo&apos;s assistant. Tell it what your app should do and it builds it with you, sign-in included, so there&apos;s no design to pick here.</p>
        </div>
        {error ? <p className="ob-error" role="alert">{error}</p> : null}
        {actions(<Button size="lg" loading={busy} rightIcon={<ArrowRight size={18} aria-hidden />} onClick={() => finish(true)}>Save and meet Sol</Button>)}
      </div>
    ) : (
      <div className="ob-wide">
        <div>
          <h1 className="ob-title">Pick a design for {name || "you"}</h1>
          <p className="ob-lead">Each one already has your name, colours and words. Pick the one you like most.</p>
        </div>
        {designs.error ? <p className="ob-error" role="alert">{designs.error}</p> : null}
        <div className="ob-designs" role="radiogroup" aria-label="Designs">
          {(designs.designs.length ? designs.designs : [null, null, null]).map((d, i) => (
            <button key={d?.id ?? i} type="button" role="radio" aria-checked={!!d && chosen?.id === d.id} className="ob-design" disabled={!d} onClick={() => d && set("designId", d.id)}>
              <ScaledFrame html={d?.html ?? null} title={d ? `${d.name} design` : "Loading design"} aspect="4 / 3" />
              <span className="ob-design__meta">
                <span><span className="ob-design__name">{d?.name ?? "Loading…"}</span><span className="ob-design__text" style={{ display: "block" }}>{d?.description ?? ""}</span></span>
                <span className="ob-design__pick">{d && chosen?.id === d.id ? "Chosen" : "Pick"}</span>
              </span>
            </button>
          ))}
        </div>
        {showAll ? (
          <section className="ob-market" aria-labelledby="ob-market-title">
            <div>
              <h2 className="ob-subtitle" id="ob-market-title">More designs to start from</h2>
              <p className="ob-lead">Made by designers on Plexo, ordered by how well they suit what you are making. Free ones cost nothing; paid ones are a one-time price. They come as their maker designed them, and your logo and colours are added to your Brand page.</p>
            </div>
            <DesignPicker goal={designProfile.goal} profile={designProfile} mock={mock} busy={busy} returnTo={searchNew ? "/welcome/setup?new=1" : "/welcome/setup"} onUse={(d) => startFromMarketDesign(d)} />
          </section>
        ) : (
          <div className="ob-more">
            <Button variant="secondary" onClick={() => { setShowAll(true); setTimeout(() => document.getElementById("ob-market-title")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); }}>See all designs</Button>
            <span className="ob-sub">Browse real designs from the Plexo marketplace, free and paid.</span>
          </div>
        )}
        <p className="ob-note">You can change anything later: the words, pictures, colours and the design itself.</p>
        {error ? <p className="ob-error" role="alert">{error}</p> : null}
        <div className="ob-actions">
          <Button variant="secondary" size="lg" leftIcon={<ArrowLeft size={18} aria-hidden />} onClick={() => go(3)}>Back</Button>
          <Button size="lg" loading={busy} loadingLabel="Building your site…" disabled={!chosen} rightIcon={<ArrowRight size={18} aria-hidden />} onClick={() => finish(false)}>Use this design</Button>
          {personalising ? <Button variant="ghost" size="lg" disabled={busy} onClick={() => finish(true)}>Skip, just personalise</Button> : null}
        </div>
      </div>
    );

  return (
    <div className="ob-page">
      <header className="ob-header">
        <PlexoLogo height={26} />
        <div className="ob-header__progress"><Stepper total={STEP_COUNT} current={step} /></div>
        {mock ? <span /> : <ContinueLaterButton />}
      </header>
      <main className="ob-main">{ready ? stepForm : null}</main>
    </div>
  );
}

export { EMPTY_DRAFT };
