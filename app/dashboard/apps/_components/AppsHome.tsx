"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Loader2, PenLine, Plus, X, type LucideIcon } from "lucide-react";
import { api, ApiError } from "./api";
import { timeAgo } from "./ui";
import { PageContainer } from "../../_components/PageContainer";
import { AttachFiles, MoreDetails, NotesField, QualityChoice, useStartContext } from "./StartContext";
import { saveHandoff } from "./startHandoff";
import { GitHubStart } from "./GitHubStart";
import type { ModelTier } from "../../sol/_components/types";

// The Apps home (wireframe "D"): pick up where you left off, or answer three quick questions —
// one at a time — while a preview of the app takes shape beside them. Plain words only.

export type HomeApp = { id: string; name: string; previewUrl: string | null; published: boolean; updatedAt: string | null; needsFix: boolean };

import {
  AUDIENCES, FEATURES, FEATURES_FOR, STARTERS, AppPreview, describeAnswers, encodePlan, suggestName, ink, muted, faint, surface, border, fill,
  accent, tint, brandGradient, hueFor, gradientFor,
  type AudienceId, type FeatureId,
} from "./appPlan";


import { BRAND } from "@/lib/theme";
// ------------------------------------------------------------------ small pieces

function Tile({ icon: Icon, title, body, on, onClick }: { icon: LucideIcon; title: string; body: string; on: boolean; onClick: () => void }) {
  const hue = hueFor(title);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className="ah-tile"
      style={{ display: "flex", gap: 14, alignItems: "center", padding: 16, borderRadius: 16, textAlign: "left", fontFamily: "inherit", color: ink, cursor: "pointer", border: on ? `2px solid ${accent}` : `1px solid ${border}`, background: on ? tint(accent, 10) : surface, margin: on ? 0 : 1, boxShadow: on ? "0 8px 24px var(--brand-subtle)" : "none" }}
    >
      <span style={{ width: 40, height: 40, borderRadius: 11, flexShrink: 0, display: "grid", placeItems: "center", background: on ? hue : tint(hue, 16), color: on ? "#fff" : hue }}>
        <Icon size={19} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: "clamp(14px, 3.9vw, 16px)", fontWeight: 700 }}>{title}</span>
        <span style={{ display: "block", fontSize: 13, color: muted }}>{body}</span>
      </span>
      <span style={{ width: 24, height: 24, borderRadius: 99, flexShrink: 0, display: "grid", placeItems: "center", background: on ? accent : "transparent", border: on ? "none" : `1.5px solid ${border}`, color: "#fff" }}>
        {on && <Check size={14} strokeWidth={3} />}
      </span>
    </button>
  );
}

/** A short, tidy name from the first line of a pasted brief ("RUKKY & DOLAPO\nWEDDING WEBSITE" → "RUKKY DOLAPO WEDDING"). */
function nameFromDescription(text: string): string {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
  return firstLine.replace(/[^\w\s-]/g, " ").split(/\s+/).filter(Boolean).slice(0, 4).join(" ") || "My app";
}

const primaryButton = (enabled: boolean): CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 8, fontFamily: "inherit", fontSize: "clamp(13.5px, 3.7vw, 15px)", fontWeight: 700, padding: "14px 24px", borderRadius: 13, border: "none",
  background: enabled ? brandGradient : fill(14), color: enabled ? "#fff" : muted, cursor: enabled ? "pointer" : "default", transition: "background 0.2s", boxShadow: enabled ? "0 8px 24px var(--brand-glow)" : "none",
});
const secondaryButton: CSSProperties = { fontFamily: "inherit", fontSize: 14.5, fontWeight: 600, padding: "13px 18px", borderRadius: 13, border: `1px solid ${border}`, background: surface, color: ink, cursor: "pointer" };
const linkButton: CSSProperties = { background: "none", border: "none", padding: 0, fontFamily: "inherit", fontSize: 13.5, color: "var(--brand)", cursor: "pointer" };
const eyebrow: CSSProperties = { fontSize: 13, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: muted };

function Thumb({ name, size }: { name: string; size: { w: number; h: number } }) {
  return (
    <span aria-hidden style={{ width: size.w, height: size.h, borderRadius: 9, flexShrink: 0, display: "grid", placeItems: "center", background: gradientFor(name), color: "#fff", fontSize: Math.round(size.h * 0.36), fontWeight: 800, textShadow: "0 1px 8px rgba(0,0,0,0.2)" }}>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

function AppCard({ app, large }: { app: HomeApp; large?: boolean }) {
  return (
    <Link href={`/dashboard/apps/${app.id}`} className="ah-card" style={{ display: "flex", gap: 14, alignItems: "center", borderRadius: 14, background: surface, padding: 10, textDecoration: "none", color: ink, border: app.needsFix ? "1.5px solid #f59e0b" : `1px solid ${border}`, minWidth: 0 }}>
      <Thumb name={app.name} size={large ? { w: 132, h: 84 } : { w: 116, h: 72 }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 14.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{app.name}</span>
        <span style={{ display: "block", fontSize: 12.5, color: muted, marginTop: 2 }}>
          <span style={{ color: app.published ? "#10b981" : muted, fontWeight: 600 }}>{app.published ? "● Live" : "○ Draft"}</span> · {timeAgo(app.updatedAt)}
        </span>
      </span>
      {app.needsFix && <span style={{ padding: "6px 10px", borderRadius: 99, background: tint("#f59e0b", 18), color: "#f59e0b", fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap" }}>Needs a fix</span>}
    </Link>
  );
}

// ------------------------------------------------------------------ the page

export function AppsHome(props: { lockedModelTier?: { tier: "BASIC"; note: string } | null; apps: HomeApp[]; userName: string | null; showAll: boolean; fontClassName?: string }) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [audience, setAudience] = useState<AudienceId | null>(null);
  const [features, setFeatures] = useState<FeatureId[]>([]);
  const [other, setOther] = useState("");
  const [name, setName] = useState("");
  const [describing, setDescribing] = useState(false);
  // "Connect a GitHub project" path: name the app, then pick the repo (see GitHubStart).
  const [connecting, setConnecting] = useState(false);
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const context = useStartContext();
  const [modelTier, setModelTier] = useState<ModelTier>("MEDIUM");

  const hasApps = props.apps.length > 0;
  // Owners with apps see a "Create a new app" button first; the questions open on click.
  const [composing, setComposing] = useState(!hasApps);
  const audienceInfo = AUDIENCES.find((a) => a.id === audience) ?? null;
  const featureChoices = useMemo(() => (audience ? FEATURES_FOR[audience] : []), [audience]);

  async function create(prompt: string, appName: string, plan?: string) {
    if (creating) return;
    if (context.uploading) return setError("Your files are still uploading — one moment.");
    if (context.failed) return setError("One of your files didn't upload. Remove it or add it again, then build.");
    setCreating(true);
    setError(null);
    try {
      // SOL builds this app from scratch, so skip the empty starter preview (it only cost a build).
      const res = await api<{ id: string }>("/api/v1/apps", { method: "POST", json: { name: appName, build: false } });
      // The brief and files go to the editor through the browser, not the address — a long
      // brief in the URL is what used to end in a "414" error page.
      saveHandoff(res.id, { prompt, plan: plan ?? null, notes: context.notes, modelTier: props.lockedModelTier ? "BASIC" : modelTier, files: context.ready });
      router.push(`/dashboard/apps/${res.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't start your app. Please try again.");
      setCreating(false);
    }
  }

  const chooseAudience = (id: AudienceId) => {
    if (id !== audience) setFeatures((f) => f.filter((x) => x === "other" || FEATURES_FOR[id].includes(x as Exclude<FeatureId, "other">)));
    setAudience(id);
  };
  const toggleFeature = (id: FeatureId) => setFeatures((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));
  const goTo = (next: 1 | 2 | 3 | 4) => {
    if (next === 3 && !name.trim()) setName(suggestName(features));
    setStep(next);
  };
  const cancel = () => {
    setComposing(false);
    setDescribing(false);
    setStep(1);
    setAudience(null);
    setFeatures([]);
    setOther("");
    setName("");
    setError(null);
    context.reset();
  };
  const startFrom = (s: (typeof STARTERS)[number]) => {
    setDescribing(false);
    setAudience(s.audience);
    setFeatures(s.features);
    setName(s.name);
    setStep(3);
  };

  const canContinue = step === 1 ? !!audience : step === 2 ? features.length > 0 && (!features.includes("other") || other.trim().length > 0) : name.trim().length > 0;
  const onContinue = () => {
    if (!canContinue) return;
    if (step < 4) return goTo((step + 1) as 2 | 3 | 4);
    void create(describeAnswers(audience!, features, other, name), name.trim(), encodePlan({ audience: audience!, features, other, name: name.trim() }));
  };

  // ---------------------------------------------------------------- all apps

  if (props.showAll) {
    return (
      <PageContainer>
        <div className={props.fontClassName} style={{ display: "flex", flexDirection: "column", gap: 22, color: ink }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Link href="/dashboard/apps" aria-label="Back" style={{ display: "inline-flex", color: muted }}><ArrowLeft size={20} /></Link>
            <h1 style={{ margin: 0, fontSize: "clamp(21px, 5.4vw, 28px)", fontWeight: 800, letterSpacing: "-0.02em" }}>All apps</h1>
            <span style={{ color: muted, fontSize: "clamp(13.5px, 3.7vw, 15px)" }}>{props.apps.length}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 14 }}>
            {props.apps.map((app) => <AppCard key={app.id} app={app} large />)}
          </div>
        </div>
        <style>{STYLES}</style>
      </PageContainer>
    );
  }

  // ---------------------------------------------------------------- home

  const answers: Array<{ label: string; step: 1 | 2 }> = [];
  if (audienceInfo && step > 1) answers.push({ label: `For ${audienceInfo.phrase}`, step: 1 });
  if (step > 2 && features.length) answers.push({ label: `${features.length} thing${features.length > 1 ? "s" : ""} they can do`, step: 2 });

  const question =
    step === 4
      ? { title: "Anything else we should know?", hint: "Optional. The more SOL has to work from, the less it has to guess." }
      : step === 1
      ? { title: "Who is it for?", hint: "This helps us shape what your app does." }
      : step === 2
        ? { title: "What should they be able to do?", hint: "Pick as many as you like." }
        : { title: "What's it called?", hint: "We've suggested a name. Change it if you like — you can rename it any time." };

  return (
    <PageContainer>
      <div className={props.fontClassName} style={{ display: "flex", flexDirection: "column", gap: 28, color: ink }}>
        {hasApps ? (
          <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16 }}>
              <h1 style={{ margin: 0, fontSize: "clamp(21px, 5.4vw, 28px)", fontWeight: 800, letterSpacing: "-0.02em" }}>{props.userName ? `Welcome back, ${props.userName}` : "Welcome back"}</h1>
              <Link href="/dashboard/apps?view=all" style={{ fontSize: 13.5, fontWeight: 600, color: "var(--brand)", textDecoration: "none", whiteSpace: "nowrap" }}>All apps ({props.apps.length}) →</Link>
            </div>
            <div style={eyebrow}>Continue where you left off</div>
            <div className="ah-recent" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14 }}>
              {props.apps.slice(0, 3).map((app) => <AppCard key={app.id} app={app} />)}
            </div>
          </section>
        ) : (
          <div>
            <h1 style={{ margin: 0, fontSize: "clamp(24px, 6.4vw, 34px)", fontWeight: 800, letterSpacing: "-0.02em" }}>Let&rsquo;s make your first app</h1>
            <p style={{ margin: "8px 0 0", fontSize: "clamp(14px, 3.9vw, 16px)", color: muted }}>Three quick questions and we&rsquo;ll build it. You can change anything later.</p>
          </div>
        )}

        {connecting ? (
          <GitHubStart onCancel={() => setConnecting(false)} />
        ) : !composing ? (
          <button type="button" onClick={() => setComposing(true)} className="ah-create" style={{ minHeight: 420, fontFamily: "inherit", color: ink, cursor: "pointer", border: `2px dashed ${tint(accent, 40)}`, borderRadius: 22, background: `radial-gradient(50% 70% at 20% 0%, ${tint(BRAND[300], 10)}, transparent 70%), radial-gradient(60% 80% at 85% 100%, ${tint(accent, 16)}, transparent 70%), ${surface}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 }}>
            <span style={{ width: 64, height: 64, borderRadius: 18, background: brandGradient, color: "#fff", display: "grid", placeItems: "center", boxShadow: "0 12px 32px var(--brand-glow)" }}><Plus size={30} /></span>
            <span style={{ fontSize: "clamp(19px, 5vw, 24px)", fontWeight: 800, letterSpacing: "-0.01em" }}>Create a new app</span>
            <span style={{ fontSize: "clamp(13.5px, 3.7vw, 15px)", color: muted }}>Answer three quick questions and we&rsquo;ll build it.</span>
          </button>
        ) : (
        <section className="ah-builder ah-fade" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", borderRadius: 22, border: `1px solid ${border}`, background: surface, overflow: "hidden", minHeight: hasApps ? 540 : 600 }}>
          {describing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (description.trim()) void create(description.trim(), nameFromDescription(description));
              }}
              style={{ padding: "clamp(20px, 5vw, 32px) clamp(18px, 5vw, 36px)", display: "flex", flexDirection: "column", gap: 20 }}
            >
              <div>
                <div style={{ fontSize: "clamp(21px, 5.6vw, 30px)", fontWeight: 800, letterSpacing: "-0.02em" }}>Describe your app</div>
                <div style={{ fontSize: "clamp(13.5px, 3.7vw, 15px)", color: muted, marginTop: 6 }}>Say who it&rsquo;s for and what they should be able to do.</div>
              </div>
              <textarea
                autoFocus
                aria-label="Describe your app"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={7}
                placeholder="A booking app for my salon where clients pick a stylist and a time, pay a deposit and get a reminder the day before…"
                style={{ width: "100%", boxSizing: "border-box", resize: "vertical", padding: 16, borderRadius: 14, border: `1px solid ${border}`, background: surface, color: ink, fontSize: "clamp(14px, 3.9vw, 16px)", lineHeight: 1.55, fontFamily: "inherit", outline: "none" }}
              />
              <AttachFiles ctx={context} />
              <MoreDetails ctx={context} />
              <QualityChoice value={modelTier} onChange={setModelTier} locked={props.lockedModelTier} />
              {error && <p role="alert" style={{ margin: 0, fontSize: 13.5, color: "#f87171" }}>{error}</p>}
              <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 12 }}>
                <button type="submit" disabled={!description.trim() || creating || context.uploading} style={primaryButton(!!description.trim() && !creating && !context.uploading)}>
                  {creating ? <><Loader2 size={16} className="ah-spin" /> Starting…</> : context.uploading ? "Uploading files…" : "Build my app"}
                </button>
                {hasApps && <button type="button" onClick={cancel} style={{ ...linkButton, color: muted }}>Cancel</button>}
                <button type="button" onClick={() => setDescribing(false)} style={{ ...linkButton, marginLeft: "auto" }}>Answer three quick questions instead</button>
              </div>
            </form>
          ) : (
            <div style={{ padding: "clamp(20px, 5vw, 32px) clamp(18px, 5vw, 36px)", display: "flex", flexDirection: "column", gap: 22, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: muted, whiteSpace: "nowrap" }}>Step {step} of 4</div>
                <div style={{ flex: 1, display: "flex", gap: 6 }}>
                  {[1, 2, 3, 4].map((i) => <span key={i} style={{ flex: 1, height: 6, borderRadius: 99, background: i <= step ? brandGradient : fill(12), transition: "background 0.3s" }} />)}
                </div>
                {hasApps && <button type="button" onClick={cancel} style={{ ...linkButton, color: muted, display: "inline-flex", alignItems: "center", gap: 4 }}><X size={14} /> Cancel</button>}
              </div>

              {answers.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 13, color: muted }}>Your answers:</span>
                  {answers.map((a) => (
                    <button key={a.label} type="button" onClick={() => setStep(a.step)} style={{ padding: "6px 12px", borderRadius: 99, border: "none", background: tint(accent, 14), color: ink, fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                      {a.label} <span style={{ color: faint, fontWeight: 500 }}>· change</span>
                    </button>
                  ))}
                </div>
              )}

              <div key={step} className="ah-fade">
                <div style={{ fontSize: "clamp(21px, 5.6vw, 30px)", fontWeight: 800, letterSpacing: "-0.02em" }}>{question.title}</div>
                <div style={{ fontSize: "clamp(13.5px, 3.7vw, 15px)", color: muted, marginTop: 6 }}>{question.hint}</div>
              </div>

              {step === 1 && (
                <div className="ah-tiles ah-fade" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                  {AUDIENCES.map((a) => <Tile key={a.id} icon={a.icon} title={a.title} body={a.body} on={audience === a.id} onClick={() => chooseAudience(a.id)} />)}
                </div>
              )}
              {step === 2 && (
                <div className="ah-fade" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div className="ah-tiles" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                    {featureChoices.map((f) => <Tile key={f} icon={FEATURES[f].icon} title={FEATURES[f].title} body={FEATURES[f].body} on={features.includes(f)} onClick={() => toggleFeature(f)} />)}
                    <Tile icon={PenLine} title="Something else" body="Tell us in a sentence" on={features.includes("other")} onClick={() => toggleFeature("other")} />
                  </div>
                  {features.includes("other") && (
                    <input
                      autoFocus
                      aria-label="What else should they be able to do?"
                      value={other}
                      onChange={(e) => setOther(e.target.value)}
                      placeholder="e.g. choose which stylist they want"
                      style={{ padding: "14px 16px", borderRadius: 14, border: `1px solid ${border}`, background: surface, color: ink, fontSize: "clamp(13.5px, 3.7vw, 15px)", fontFamily: "inherit", outline: "none" }}
                    />
                  )}
                </div>
              )}
              {step === 3 && (
                <input
                  autoFocus
                  className="ah-fade"
                  aria-label="Your app's name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && onContinue()}
                  maxLength={60}
                  style={{ padding: "18px 20px", borderRadius: 16, border: `2px solid ${accent}`, background: surface, color: ink, fontSize: "clamp(17px, 4.6vw, 22px)", fontWeight: 700, fontFamily: "inherit", outline: "none" }}
                />
              )}

              {step === 4 && (
                <div className="ah-fade" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <NotesField ctx={context} />
                  <AttachFiles ctx={context} />
                  <MoreDetails ctx={context} hideNotes />
                  <QualityChoice value={modelTier} onChange={setModelTier} locked={props.lockedModelTier} />
                </div>
              )}

              {error && <p role="alert" style={{ margin: 0, fontSize: 13.5, color: "#f87171" }}>{error}</p>}

              <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                {step > 1 && <button type="button" onClick={() => setStep((step - 1) as 1 | 2 | 3)} style={secondaryButton}>Back</button>}
                <button type="button" onClick={onContinue} disabled={!canContinue || creating || context.uploading} style={primaryButton(canContinue && !creating && !context.uploading)}>
                  {creating ? <><Loader2 size={16} className="ah-spin" /> Starting…</> : context.uploading ? "Uploading files…" : step === 4 ? <>Build my app <ArrowRight size={16} /></> : "Continue"}
                </button>
                <button type="button" onClick={() => setDescribing(true)} style={{ ...linkButton, marginLeft: "auto" }}>Rather describe it in your own words?</button>
              </div>
            </div>
          )}

          <div className="ah-preview" style={{ background: `radial-gradient(80% 60% at 100% 0%, ${tint(accent, 12)}, transparent 70%), ${fill(3)}`, padding: 28, display: "flex", flexDirection: "column", gap: 12, borderLeft: `1px solid ${border}` }}>
            {describing ? (
              <div style={{ flex: 1, borderRadius: 14, border: `1px solid ${border}`, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 24, color: muted, fontSize: 13.5, background: `repeating-linear-gradient(135deg, ${fill(2)} 0 12px, ${fill(4)} 12px 24px)` }}>
                We&rsquo;ll show your app here as soon as it&rsquo;s built.
              </div>
            ) : (
              <AppPreview audience={audience} features={features} other={other} name={step >= 3 ? name : ""} />
            )}
            <div style={{ fontSize: 12.5, color: muted, textAlign: "center" }}>A preview of what we&rsquo;ll build</div>
          </div>
        </section>
        )}

        {!composing && !connecting && (
          <button type="button" onClick={() => setConnecting(true)} style={{ ...linkButton, alignSelf: "center", fontSize: 15, fontWeight: 600 }}>
            Or connect a GitHub project →
          </button>
        )}

        {!hasApps && !connecting && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 13.5, color: muted }}>
            Or start from an example:
            {STARTERS.map((s) => (
              <button key={s.title} type="button" onClick={() => startFrom(s)} style={{ padding: "7px 13px", borderRadius: 99, border: `1px solid ${border}`, background: "transparent", color: ink, fontFamily: "inherit", fontSize: 13.5, cursor: "pointer" }}>
                {s.title}
              </button>
            ))}
          </div>
        )}
      </div>
      <style>{STYLES}</style>
    </PageContainer>
  );
}

const STYLES = `
  .ah-tile { transition: border-color 0.15s, background 0.15s, transform 0.15s; }
  .ah-tile:hover { transform: translateY(-1px); }
  .ah-card { transition: transform 0.15s, border-color 0.15s; }
  .ah-create { transition: border-color 0.15s, background 0.15s; }
  .ah-create:hover { border-color: var(--brand) !important; }
  .ah-card:hover { transform: translateY(-1px); }
  .ah-fade { animation: ah-fade 0.3s ease-out; }
  @keyframes ah-fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  .ah-spin { animation: ah-spin 0.9s linear infinite; }
  @keyframes ah-spin { to { transform: rotate(360deg); } }
  @media (max-width: 1100px) { .ah-builder { grid-template-columns: minmax(0, 1fr) !important; } .ah-preview { border-left: none !important; min-height: 380px; } }
  @media (max-width: 900px) { .ah-recent { grid-template-columns: minmax(0, 1fr) !important; } }
  @media (max-width: 640px) { .ah-tiles { grid-template-columns: minmax(0, 1fr) !important; } }
  @media (prefers-reduced-motion: reduce) { .ah-fade, .ah-spin { animation: none; } .ah-tile:hover, .ah-card:hover { transform: none; } }
`;
