"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CustomSelect } from "../../_components/CustomSelect";
import { registrableDomain } from "@/lib/domains/registrable";
import {
  STEP_LABEL,
  alreadyCreated,
  certUi,
  certificateRecordName,
  customDomainProblem,
  isApexDomain,
  normalizeDomainInput,
  pointRecordName,
  resumeStep,
  stepPosition,
  stepsFor,
  wwwVersionOf,
  type CertUi,
  type WizardDomainType,
  type WizardStep,
} from "@/lib/domains/wizard";

// The "Connect a domain" wizard. Replaces the old side drawer, which showed everything at once, never said why a
// second DNS record was needed, and could be submitted twice. One thing per step, in plain words:
//   Choose → (own domain) Your domain → Point it at Plexo → Secure it → All set
//   Choose → (Plexo address) Your address → All set          Choose → (buy) Buy a domain
// The domain is created once, when leaving "Your domain"; every later Next just moves on.

export type WizardDomain = {
  id: string;
  domain: string;
  type: WizardDomainType;
  templateId: string;
  certificateStatus?: "PENDING_VALIDATION" | "ISSUED" | "ATTACHED" | "FAILED";
  certificateValidationName?: string;
  certificateValidationValue?: string;
  dnsVerified?: boolean;
};

export type LinkDomainWizardProps = {
  onClose: () => void;
  landingPages: { id: string; name: string }[];
  /** Finish setting up a domain that already exists (opens at the first step still to do). */
  existing: WizardDomain | null;
  initialTemplateId: string;
  /** "BUY" when returning from a domain purchase's checkout. */
  initialType?: WizardDomainType;
  canUseCustomDomain: boolean;
  onUpgrade: () => void;
  /** The Plexo address ending, e.g. plexopages.com. */
  baseDomain: string;
  /** What the first record points to. */
  routingTarget: string;
  atLimit: boolean;
  /** Called whenever something changed on the server, so the list behind the wizard refreshes. */
  onChanged: () => void | Promise<void>;
  renderBuy: (templateId: string) => React.ReactNode;
  getVisitUrl: (domain: string) => string;
};

type LiveState = Pick<WizardDomain, "certificateStatus" | "certificateValidationName" | "certificateValidationValue" | "dnsVerified">;

const MODAL_CSS = `
@keyframes dlw-fade{from{opacity:0}to{opacity:1}}
@keyframes dlw-rise{from{opacity:0;transform:translateY(12px) scale(.985)}to{opacity:1;transform:none}}
@keyframes dlw-spin{to{transform:rotate(360deg)}}
.dlw-overlay{position:fixed;inset:0;z-index:9998;background:rgba(5,6,12,.62);backdrop-filter:blur(5px);animation:dlw-fade .2s ease}
.dlw-wrap{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;pointer-events:none}
.dlw-modal{pointer-events:auto;width:100%;max-width:640px;max-height:min(92vh,860px);display:flex;flex-direction:column;background:rgba(18,16,36,.99);border:1px solid rgba(255,255,255,.09);border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.55);animation:dlw-rise .25s cubic-bezier(.16,1,.3,1);outline:none}
.dlw-body{overflow-y:auto;padding:1.4rem 1.6rem 1.2rem;display:flex;flex-direction:column;gap:1rem}
.dlw-record{display:grid;grid-template-columns:78px minmax(0,1fr);gap:.55rem .75rem;align-items:start;background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:.9rem 1rem}
.dlw-record dt{font-size:.68rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:rgba(240,242,255,.38);padding-top:.2rem}
.dlw-record dd{margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.82rem;color:#f0f2ff;font-weight:600;display:flex;gap:.5rem;align-items:flex-start;justify-content:space-between;min-width:0}
.dlw-record dd>span{min-width:0;overflow-wrap:anywhere;word-break:break-all}
.dlw-card{display:flex;gap:.85rem;align-items:flex-start;text-align:left;width:100%;padding:.95rem 1rem;border-radius:12px;background:rgba(255,255,255,.03);border:1.5px solid rgba(255,255,255,.08);color:inherit;font:inherit;cursor:pointer;transition:border-color .15s,background .15s}
.dlw-card:hover{background:rgba(255,255,255,.05)}
.dlw-card[aria-checked="true"]{border-color:var(--brand);background:rgba(var(--brand-rgb),.09)}
.dlw-card:focus-visible,.dlw-btn:focus-visible,.dlw-link:focus-visible,.dlw-copy:focus-visible,.dlw-x:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
.dlw-btn{padding:.65rem 1.2rem;border-radius:10px;font:inherit;font-size:.86rem;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:.45rem;white-space:nowrap}
.dlw-btn:disabled{opacity:.55;cursor:not-allowed}
.dlw-primary{background:linear-gradient(135deg,var(--brand),var(--brand-deep));border:none;color:#fff;box-shadow:0 4px 14px var(--brand-glow)}
.dlw-ghost{background:none;border:1px solid rgba(255,255,255,.12);color:rgba(240,242,255,.8)}
.dlw-link{background:none;border:none;padding:0;font:inherit;font-size:inherit;color:var(--brand);font-weight:600;cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.dlw-copy{flex-shrink:0;display:inline-flex;align-items:center;gap:.3rem;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:rgba(240,242,255,.75);border-radius:7px;padding:.22rem .55rem;font:inherit;font-size:.7rem;font-weight:600;cursor:pointer}
.dlw-x{background:none;border:none;cursor:pointer;color:rgba(240,242,255,.45);padding:.3rem;border-radius:8px;display:flex}
.dlw-x:hover{color:#f0f2ff}
.dlw-spin{width:14px;height:14px;border-radius:50%;border:2px solid rgba(255,255,255,.25);border-top-color:#fff;animation:dlw-spin .7s linear infinite;display:inline-block}
@media(max-width:640px){
  .dlw-wrap{padding:0;align-items:stretch}
  .dlw-modal{max-width:none;max-height:none;height:100%;border-radius:0;border:none}
  .dlw-body{padding:1.1rem 1.1rem 1rem}
  .dlw-record{grid-template-columns:1fr}
  .dlw-footer{padding:.8rem 1.1rem !important}
}
@media(prefers-reduced-motion:reduce){.dlw-modal,.dlw-overlay{animation:none}.dlw-spin{animation-duration:2s}}
`;

// ───────────────────────────────────────────────────────────── small pieces

function Check({ size = 16, color = "#34d399" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function Clock({ color = "#f59e0b" }: { color?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" />
    </svg>
  );
}
function Cross({ color = "#f87171" }: { color?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}
function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.prompt("Copy this:", text);
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1800);
  }
  return (
    <button type="button" className="dlw-copy" onClick={() => void copy()} aria-label={`Copy ${label}`}>
      {copied ? <><Check size={12} /> Copied</> : <><CopyIcon /> Copy</>}
    </button>
  );
}

function Record({ type, name, value, nameHint }: { type: string; name: string; value: string; nameHint?: string }) {
  return (
    <div>
      <dl className="dlw-record">
        <dt>Type</dt>
        <dd><span>{type}</span></dd>
        <dt>Name</dt>
        <dd><span>{name}</span><CopyButton text={name} label="the name" /></dd>
        <dt>Value</dt>
        <dd><span>{value}</span><CopyButton text={value} label="the value" /></dd>
      </dl>
      {nameHint && <p style={{ ...muted, margin: "0.45rem 0 0", fontSize: "0.74rem" }}>{nameHint}</p>}
    </div>
  );
}

const muted: React.CSSProperties = { color: "rgba(240,242,255,0.55)", fontSize: "0.83rem", lineHeight: 1.55, margin: 0 };
const strong: React.CSSProperties = { color: "#f0f2ff", fontWeight: 650 };

function Notice({ tone, title, children }: { tone: "info" | "warn" | "ok" | "bad"; title?: string; children: React.ReactNode }) {
  const c = { info: ["rgba(var(--brand-rgb),0.07)", "rgba(var(--brand-rgb),0.2)", "#a5b4fc"], warn: ["rgba(251,191,36,0.07)", "rgba(251,191,36,0.28)", "#fbbf24"], ok: ["rgba(52,211,153,0.07)", "rgba(52,211,153,0.28)", "#34d399"], bad: ["rgba(248,113,113,0.07)", "rgba(248,113,113,0.3)", "#f87171"] }[tone];
  return (
    <div style={{ background: c[0], border: `1px solid ${c[1]}`, borderRadius: 12, padding: "0.8rem 0.95rem" }}>
      {title && <p style={{ margin: "0 0 0.3rem", fontWeight: 700, fontSize: "0.82rem", color: c[2] }}>{title}</p>}
      <div style={{ ...muted, fontSize: "0.8rem" }}>{children}</div>
    </div>
  );
}

function Heading({ children, sub, headingRef }: { children: React.ReactNode; sub?: React.ReactNode; headingRef: React.RefObject<HTMLHeadingElement | null> }) {
  return (
    <div>
      <h2 ref={headingRef} tabIndex={-1} style={{ margin: 0, fontSize: "1.2rem", fontWeight: 800, color: "#f0f2ff", letterSpacing: "-0.01em", outline: "none" }}>{children}</h2>
      {sub && <p style={{ ...muted, margin: "0.4rem 0 0" }}>{sub}</p>}
    </div>
  );
}

function friendlyError(status: number, payload: { error?: unknown }): string {
  if (typeof payload?.error === "string" && payload.error) return payload.error;
  if (status === 401) return "You've been signed out. Please sign in again and try once more.";
  if (status === 403) return "Your account doesn't have permission to connect domains. Ask the account owner.";
  return "Something went wrong on our side. Please try again in a moment.";
}

// ───────────────────────────────────────────────────────────── the wizard

export function LinkDomainWizard(props: LinkDomainWizardProps) {
  const { existing, landingPages, canUseCustomDomain, baseDomain, routingTarget } = props;
  const titleId = useId();
  const modalRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const onChangedRef = useRef(props.onChanged);
  onChangedRef.current = props.onChanged;

  const [type, setType] = useState<WizardDomainType>(
    existing ? existing.type : props.initialType ?? (canUseCustomDomain ? "CUSTOM" : "SUBDOMAIN"),
  );
  const [step, setStep] = useState<WizardStep>(
    existing ? resumeStep(existing) : props.initialType === "BUY" ? "buy" : "choose",
  );
  const [templateId, setTemplateId] = useState(existing?.templateId ?? props.initialTemplateId);
  const [subdomain, setSubdomain] = useState("");
  const [domainInput, setDomainInput] = useState(existing?.type === "CUSTOM" ? existing.domain : "");
  const [created, setCreated] = useState<WizardDomain | null>(existing);
  const [live, setLive] = useState<LiveState>({
    certificateStatus: existing?.certificateStatus,
    certificateValidationName: existing?.certificateValidationName,
    certificateValidationValue: existing?.certificateValidationValue,
    dnsVerified: existing?.dnsVerified,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dnsCheck, setDnsCheck] = useState<{ state: "idle" | "checking" | "found" | "missing" | "error" }>({ state: "idle" });
  const [showFullName, setShowFullName] = useState(false);

  const customDomain = normalizeDomainInput(domainInput, { final: true });
  const cert: CertUi = certUi(live.certificateStatus, !!(live.certificateValidationName && live.certificateValidationValue));
  const position = stepPosition(step, type);

  // ── dialog behaviour: focus in, keep it in, Esc closes, page behind doesn't scroll
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modalRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, []);

  // Each step's heading names the dialog and receives focus, so a screen reader announces where you are.
  useEffect(() => {
    if (headingRef.current) {
      headingRef.current.id = titleId;
      headingRef.current.focus({ preventScroll: true });
    }
  }, [step, titleId]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      props.onClose();
      return;
    }
    if (e.key !== "Tab" || !modalRef.current) return;
    const focusable = Array.from(
      modalRef.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'),
    ).filter((el) => el.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === modalRef.current || active === headingRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // ── keep the certificate status fresh while someone is looking at it (one request at a time, stops when closed)
  const watching = !!created && created.type === "CUSTOM" && (step === "certificate" || step === "done") && cert !== "live" && cert !== "failed";
  useEffect(() => {
    if (!watching || !created) return;
    let stopped = false;
    let inFlight = false;
    const every = cert === "preparing" ? 4000 : 10000;
    const tick = async () => {
      if (inFlight || stopped) return;
      inFlight = true;
      try {
        const res = await fetch("/api/v1/domains", { cache: "no-store" });
        const data = await res.json();
        const mine = (data.domains as Array<Record<string, unknown>> | undefined)?.find((d) => d.id === created.id);
        if (!mine || stopped) return;
        setLive((prev) => {
          const next: LiveState = {
            certificateStatus: mine.certificateStatus as LiveState["certificateStatus"],
            certificateValidationName: (mine.certificateValidationName as string | undefined) ?? prev.certificateValidationName,
            certificateValidationValue: (mine.certificateValidationValue as string | undefined) ?? prev.certificateValidationValue,
            dnsVerified: (mine.dnsVerified as boolean | undefined) ?? prev.dnsVerified,
          };
          if (next.certificateStatus !== prev.certificateStatus || next.dnsVerified !== prev.dnsVerified) void onChangedRef.current();
          return next;
        });
      } catch {
        /* a missed check is fine — the next one will do */
      } finally {
        inFlight = false;
      }
    };
    const id = setInterval(() => void tick(), every);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [watching, created, cert]);

  // ── actions
  async function createDomain(kind: "CUSTOM" | "SUBDOMAIN", value: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, type: kind, domain: value }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(friendlyError(res.status, payload));
      const d = payload.domain;
      setCreated({
        id: d.id,
        domain: d.domain,
        type: d.type,
        templateId: d.templateId ?? templateId,
        certificateStatus: d.certificateStatus,
        certificateValidationName: d.certificateValidationName,
        certificateValidationValue: d.certificateValidationValue,
        dnsVerified: d.dnsVerified,
      });
      setLive({
        certificateStatus: d.certificateStatus,
        certificateValidationName: d.certificateValidationName,
        certificateValidationValue: d.certificateValidationValue,
        dnsVerified: d.dnsVerified,
      });
      void onChangedRef.current();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function checkDns() {
    if (!created) return;
    setDnsCheck({ state: "checking" });
    try {
      const res = await fetch(`/api/v1/domains/verify?domain=${encodeURIComponent(created.domain)}`);
      const data = await res.json();
      if (!res.ok) throw new Error("check failed");
      setDnsCheck({ state: data.valid ? "found" : "missing" });
      setLive((l) => ({ ...l, dnsVerified: !!data.valid }));
      void onChangedRef.current();
    } catch {
      setDnsCheck({ state: "error" });
    }
  }

  function go(next: WizardStep) {
    setError(null);
    setStep(next);
  }

  function back() {
    if (step === "domain" || step === "address" || step === "buy") go("choose");
    else if (step === "point") go("domain");
    else if (step === "certificate") go("point");
    else if (step === "done" && created?.type === "CUSTOM") go("certificate");
  }

  function chooseNext() {
    if (!templateId) {
      setError("Choose which of your sites this is for.");
      return;
    }
    if (type !== "SUBDOMAIN" && !canUseCustomDomain) {
      props.onUpgrade();
      return;
    }
    go(type === "CUSTOM" ? "domain" : type === "BUY" ? "buy" : "address");
  }

  async function domainNext() {
    const domain = customDomain;
    setDomainInput(domain);
    const problem = customDomainProblem(domain);
    if (problem) return setError(problem);
    if (!templateId) return setError("Choose which of your sites this is for.");
    if (alreadyCreated(created, domain, templateId)) return go("point");
    if (props.atLimit && !created) return setError("You've reached your plan's limit of domains. Remove one you no longer use, or upgrade for more.");
    if (await createDomain("CUSTOM", domain)) go("point");
  }

  async function addressNext() {
    if (!subdomain) return setError("Type the address you'd like, for example your business name.");
    if (subdomain.length < 2) return setError("That's a little short — use at least 2 characters.");
    if (alreadyCreated(created, `${subdomain}.${baseDomain}`, templateId)) return go("done");
    if (props.atLimit && !created) return setError("You've reached your plan's limit of domains. Remove one you no longer use, or upgrade for more.");
    if (await createDomain("SUBDOMAIN", subdomain)) go("done");
  }

  // ── content for each step
  const pageOptions = landingPages.length > 0 ? landingPages.map((p) => ({ label: p.name, value: p.id })) : [{ label: "No sites yet", value: "" }];
  const routing = created ? pointRecordName(created.domain) : pointRecordName(customDomain || "www.example.com");
  const apexNow = isApexDomain(created?.domain ?? customDomain);
  const liveUrl = created ? props.getVisitUrl(created.domain) : "#";

  const titleFor: Record<WizardStep, string> = {
    choose: "Connect a domain",
    address: "Pick your Plexo address",
    domain: "Which domain do you want to use?",
    point: `Point ${created?.domain ?? "your domain"} at Plexo`,
    certificate: "Prove it's yours, to switch on https",
    buy: "Buy a domain",
    done: type === "SUBDOMAIN" ? "Your site is live" : cert === "live" ? "You're live and secure" : "You're almost there",
  };

  let body: React.ReactNode = null;
  let footer: React.ReactNode = null;

  if (step === "choose") {
    const options: { value: WizardDomainType; title: string; text: string; pro?: boolean }[] = [
      { value: "SUBDOMAIN", title: "A Plexo address", text: "Free and instant — something like yourname.plexopages.com. Nothing to set up." },
      { value: "CUSTOM", title: "A domain I already own", text: "Use your own web address, like www.mybusiness.com. It takes a one-time setup at the company you bought it from — we'll walk you through it.", pro: true },
      { value: "BUY", title: "Buy a new domain", text: "Search for a name and buy it here. We set everything up for you.", pro: true },
    ];
    body = (
      <>
        <Heading headingRef={headingRef} sub="Your site can have its own web address, so visitors type your name instead of a long link.">Connect a domain</Heading>
        <div>
          <label className="field-label" htmlFor="dlw-site" style={{ display: "block", marginBottom: "0.35rem" }}>Which site is it for?</label>
          <div id="dlw-site"><CustomSelect value={templateId} onChange={setTemplateId} options={pageOptions} /></div>
        </div>
        <div role="radiogroup" aria-label="How do you want to connect?" style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          {options.map((o) => (
            <button key={o.value} type="button" role="radio" aria-checked={type === o.value} className="dlw-card"
              onClick={() => {
                setError(null);
                if (o.pro && !canUseCustomDomain) return props.onUpgrade();
                setType(o.value);
              }}>
              <span style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${type === o.value ? "var(--brand)" : "rgba(255,255,255,0.25)"}`, marginTop: 2, flexShrink: 0, display: "grid", placeItems: "center" }} aria-hidden="true">
                {type === o.value && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--brand)" }} />}
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: "0.2rem", minWidth: 0 }}>
                <span style={{ ...strong, fontSize: "0.92rem", display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                  {o.title}
                  {o.pro && !canUseCustomDomain && <span style={{ fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--brand)", background: "var(--brand-subtle)", padding: "0.1rem 0.4rem", borderRadius: 4 }}>Starter</span>}
                </span>
                <span style={{ ...muted, fontSize: "0.79rem" }}>{o.text}</span>
              </span>
            </button>
          ))}
        </div>
      </>
    );
    footer = (
      <>
        <span />
        <button type="button" className="dlw-btn dlw-primary" onClick={chooseNext} disabled={landingPages.length === 0}>Continue</button>
      </>
    );
  }

  if (step === "address") {
    body = (
      <>
        <Heading headingRef={headingRef} sub="This is the free address your visitors will use. You can still connect your own domain later.">Pick your Plexo address</Heading>
        <div>
          <label className="field-label" htmlFor="dlw-sub" style={{ display: "block", marginBottom: "0.35rem" }}>Address</label>
          <div style={{ display: "flex", alignItems: "stretch" }}>
            <input id="dlw-sub" className="field-input" autoFocus placeholder="my-company" value={subdomain}
              onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addressNext(); } }}
              style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0, flex: 1, minWidth: 0 }} readOnly={!!created} aria-describedby="dlw-sub-help" />
            <span style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderLeft: "none", borderTopRightRadius: 8, borderBottomRightRadius: 8, display: "flex", alignItems: "center", padding: "0 0.75rem", fontSize: "0.8rem", color: "rgba(240,242,255,0.5)", fontWeight: 550 }}>.{baseDomain}</span>
          </div>
          <p id="dlw-sub-help" style={{ ...muted, fontSize: "0.74rem", marginTop: "0.4rem" }}>Letters, numbers and hyphens only.</p>
        </div>
      </>
    );
    footer = (
      <>
        <button type="button" className="dlw-btn dlw-ghost" onClick={back}>Back</button>
        <button type="button" className="dlw-btn dlw-primary" onClick={() => void addressNext()} disabled={busy}>{busy ? <><span className="dlw-spin" /> Linking…</> : "Link this address"}</button>
      </>
    );
  }

  if (step === "domain") {
    const locked = !!created;
    body = (
      <>
        <Heading headingRef={headingRef} sub="Type the web address you bought, exactly as visitors should type it. Most people use the version starting with www.">Which domain do you want to use?</Heading>
        <div>
          <label className="field-label" htmlFor="dlw-domain" style={{ display: "block", marginBottom: "0.35rem" }}>Your domain</label>
          <input id="dlw-domain" className="field-input" autoFocus placeholder="www.mybusiness.com" value={domainInput} readOnly={locked}
            inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false}
            onChange={(e) => { setError(null); setDomainInput(normalizeDomainInput(e.target.value)); }}
            onBlur={() => !locked && setDomainInput((v) => normalizeDomainInput(v, { final: true }))}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void domainNext(); } }}
            aria-invalid={!!error} aria-describedby="dlw-domain-help" />
          <p id="dlw-domain-help" style={{ ...muted, fontSize: "0.74rem", marginTop: "0.4rem" }}>
            {locked ? "This domain is already set up. To use a different one, finish here, then remove this one from the list and connect the new one." : "No need to type https:// — we tidy that up."}
          </p>
        </div>
        {!locked && isApexDomain(customDomain) && (
          <Notice tone="warn" title={`${customDomain} has no “www” in front`}>
            <p style={{ margin: "0 0 0.5rem" }}>Most domain companies — GoDaddy included — don&apos;t allow the kind of setting we need on a bare domain like this. The easy fix is to connect <strong style={strong}>{wwwVersionOf(customDomain)}</strong> instead, then ask your domain company to forward {customDomain} to it (look for “Domain forwarding” in its settings).</p>
            <button type="button" className="dlw-btn dlw-primary" style={{ padding: "0.45rem 0.9rem", fontSize: "0.8rem" }} onClick={() => { setDomainInput(wwwVersionOf(customDomain)); setError(null); }}>Use {wwwVersionOf(customDomain)} instead</button>
            <p style={{ margin: "0.6rem 0 0" }}>Prefer the bare domain? That works if your domain company offers an <em>ALIAS</em> or <em>ANAME</em> record (Cloudflare, Namecheap and DNSimple do) — just continue.</p>
          </Notice>
        )}
      </>
    );
    footer = (
      <>
        <button type="button" className="dlw-btn dlw-ghost" onClick={back}>Back</button>
        <button type="button" className="dlw-btn dlw-primary" onClick={() => void domainNext()} disabled={busy}>{busy ? <><span className="dlw-spin" /> Connecting…</> : "Continue"}</button>
      </>
    );
  }

  if (step === "point") {
    body = (
      <>
        <Heading headingRef={headingRef} sub={<>A <strong style={strong}>DNS record</strong> is a small setting at the company where you registered your domain (GoDaddy, Namecheap, Cloudflare…). This first one tells the internet to send visitors of <strong style={strong}>{created?.domain}</strong> to your Plexo site.</>}>
          Point {created?.domain} at Plexo
        </Heading>
        <Record type={apexNow ? "CNAME (or ALIAS / ANAME)" : "CNAME"} name={routing} value={routingTarget} nameHint={routing === "@" ? "“@” means the bare domain itself." : undefined} />
        <Notice tone="info" title="How to add it">
          <ol style={{ margin: 0, paddingLeft: "1.1rem", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
            <li>Sign in where you registered the domain and open its <strong style={strong}>DNS settings</strong> (sometimes “DNS records” or “Manage DNS”).</li>
            <li>Choose <strong style={strong}>Add record</strong>, pick the type above, and paste the Name and Value.</li>
            <li>In the Name box type <strong style={strong}>only what’s shown</strong>. Your domain company adds <em>{created ? registrableDomain(created.domain) : "your domain"}</em> itself — typing the whole domain would break it.</li>
          </ol>
        </Notice>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <button type="button" className="dlw-btn dlw-ghost" onClick={() => void checkDns()} disabled={dnsCheck.state === "checking"}>
            {dnsCheck.state === "checking" ? <><span className="dlw-spin" /> Checking…</> : "Check my DNS"}
          </button>
          <div aria-live="polite" style={{ fontSize: "0.82rem", display: "flex", gap: "0.45rem", alignItems: "center" }}>
            {(dnsCheck.state === "found" || (dnsCheck.state === "idle" && live.dnsVerified)) && <><Check /> <span style={{ color: "#34d399" }}>Found — {created?.domain} points to Plexo.</span></>}
            {dnsCheck.state === "missing" && <><Clock /> <span style={{ color: "#fbbf24" }}>Not found yet. DNS changes can take a few minutes, sometimes a few hours — you can carry on and check again later.</span></>}
            {dnsCheck.state === "error" && <><Cross /> <span style={{ color: "#f87171" }}>We couldn’t run the check just now. Please try again.</span></>}
          </div>
        </div>
      </>
    );
    footer = (
      <>
        <button type="button" className="dlw-btn dlw-ghost" onClick={back}>Back</button>
        <button type="button" className="dlw-btn dlw-primary" onClick={() => go("certificate")}>Next: secure your domain</button>
      </>
    );
  }

  if (step === "certificate") {
    const fullName = live.certificateValidationName ?? "";
    body = (
      <>
        <Heading headingRef={headingRef} sub={<>Browsers only trust a website that has a security certificate — the padlock in the address bar. To give <strong style={strong}>{created?.domain}</strong> one, we have to check that you control it. This second record does that.</>}>
          Prove it’s yours, to switch on https
        </Heading>
        <Notice tone="warn" title="This one is required">
          Without it your visitors would see a “Not secure” warning, and your site won’t load properly on this address. It’s a one-time step.
        </Notice>
        {cert === "preparing" ? (
          <div role="status" style={{ display: "flex", alignItems: "center", gap: "0.6rem", ...muted }}><span className="dlw-spin" style={{ borderColor: "rgba(255,255,255,0.2)", borderTopColor: "var(--brand)" }} /> Preparing your record… this takes a few seconds.</div>
        ) : (
          <>
            <Record type="CNAME" name={certificateRecordName(fullName, created?.domain ?? "")} value={(live.certificateValidationValue ?? "").replace(/\.$/, "")}
              nameHint="Enter the Name exactly as shown, including any dots — your domain company adds your domain to the end itself." />
            <div>
              <button type="button" className="dlw-link" style={{ fontSize: "0.78rem" }} aria-expanded={showFullName} onClick={() => setShowFullName((v) => !v)}>
                {showFullName ? "Hide the full record name" : "Show the full record name"}
              </button>
              {showFullName && (
                <div style={{ marginTop: "0.5rem" }}>
                  <p style={{ ...muted, fontSize: "0.76rem", margin: "0 0 0.4rem" }}>Some domain companies want the complete name instead. Use this only if the short Name above isn’t accepted:</p>
                  <div className="dlw-record" style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
                    <div style={{ display: "flex", gap: "0.5rem", justifyContent: "space-between", alignItems: "flex-start", fontFamily: "ui-monospace,monospace", fontSize: "0.8rem", color: "#f0f2ff", fontWeight: 600 }}>
                      <span style={{ overflowWrap: "anywhere" }}>{fullName.replace(/\.$/, "")}</span>
                      <CopyButton text={fullName.replace(/\.$/, "")} label="the full name" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
        <div role="status" aria-live="polite">
          {cert === "waiting" && (
            <Notice tone="info" title="Waiting for your record…">
              <span style={{ display: "inline-flex", gap: "0.5rem", alignItems: "center" }}><span className="dlw-spin" style={{ borderColor: "rgba(255,255,255,0.2)", borderTopColor: "var(--brand)", width: 12, height: 12 }} /> We check every few seconds — no need to refresh. It usually takes a few minutes and can take up to 30.</span>
            </Notice>
          )}
          {cert === "issuing" && <Notice tone="info" title="Record found — issuing your certificate…">Nearly there. This usually takes a few minutes.</Notice>}
          {cert === "live" && <Notice tone="ok" title="Secure and live"><span style={{ display: "inline-flex", gap: "0.4rem", alignItems: "center" }}><Check /> {created?.domain} now has https.</span></Notice>}
          {cert === "failed" && (
            <Notice tone="bad" title="We couldn’t issue the certificate">
              Check that the Name and Value above match what’s in your domain company’s DNS settings exactly, then give it a few minutes. If it still fails, remove this domain from the list, connect it again, and use the new record — or send us feedback from the dashboard and we’ll sort it out.
            </Notice>
          )}
        </div>
      </>
    );
    footer = (
      <>
        <button type="button" className="dlw-btn dlw-ghost" onClick={back}>Back</button>
        <button type="button" className="dlw-btn dlw-primary" onClick={() => go("done")}>{cert === "live" ? "Finish" : "I’ve added it — finish later"}</button>
      </>
    );
  }

  if (step === "buy") {
    body = (
      <>
        <Heading headingRef={headingRef} sub="Search for a name. After you buy it we connect it to your site automatically — no records to add.">Buy a domain</Heading>
        {props.renderBuy(templateId)}
      </>
    );
    footer = (
      <>
        <button type="button" className="dlw-btn dlw-ghost" onClick={back}>Back</button>
        <span />
      </>
    );
  }

  if (step === "done") {
    const isSub = created?.type === "SUBDOMAIN";
    const liveNow = isSub || cert === "live";
    const rows: { ok: boolean | "wait" | "bad"; text: string }[] = isSub
      ? []
      : [
          { ok: true, text: `${created?.domain} is connected to your site` },
          { ok: live.dnsVerified ? true : "wait", text: live.dnsVerified ? "Pointing at Plexo — confirmed" : "Pointing at Plexo — we haven’t seen the first record yet" },
          { ok: cert === "live" ? true : cert === "failed" ? "bad" : "wait", text: cert === "live" ? "Secure (https) — switched on" : cert === "failed" ? "Secure (https) — the certificate couldn’t be issued" : cert === "issuing" ? "Secure (https) — issuing your certificate…" : "Secure (https) — waiting for the second record" },
        ];
    body = (
      <>
        <Heading headingRef={headingRef} sub={liveNow ? "Visitors can open your site at this address now." : "Nothing more to do right now. We keep checking in the background and switch it on the moment the records are found."}>
          {titleFor.done}
        </Heading>
        {liveNow && created && (
          <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="dlw-btn dlw-primary" style={{ textDecoration: "none", alignSelf: "flex-start" }}>Visit {created.domain} ↗</a>
        )}
        {rows.length > 0 && (
          <ul aria-live="polite" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.55rem" }}>
            {rows.map((r) => (
              <li key={r.text} style={{ display: "flex", gap: "0.55rem", alignItems: "flex-start", ...muted, color: r.ok === true ? "#f0f2ff" : "rgba(240,242,255,0.7)" }}>
                <span style={{ marginTop: 2 }}>{r.ok === true ? <Check /> : r.ok === "bad" ? <Cross /> : <Clock />}</span>{r.text}
              </li>
            ))}
          </ul>
        )}
        {!liveNow && (
          <Notice tone="info">
            You can close this. The Domains page shows the status, and <strong style={strong}>Finish setup</strong> next to {created?.domain} brings you back to these instructions any time. DNS changes can take a few minutes — sometimes a few hours.
          </Notice>
        )}
      </>
    );
    footer = (
      <>
        {created?.type === "CUSTOM" ? <button type="button" className="dlw-btn dlw-ghost" onClick={back}>See the records</button> : <span />}
        <button type="button" className="dlw-btn dlw-primary" onClick={props.onClose}>Done</button>
      </>
    );
  }

  const stepList = stepsFor(type);

  return (
    <>
      <style>{MODAL_CSS}</style>
      <div className="dlw-overlay" onClick={props.onClose} aria-hidden="true" />
      <div className="dlw-wrap">
        <div ref={modalRef} className="dlw-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}>
          <div style={{ padding: "1rem 1.2rem 0.85rem 1.6rem", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", flexDirection: "column", gap: "0.7rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
              <div style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--brand)" }}>
                {position ? <>Step {position.n} of {position.of} · {STEP_LABEL[step]}</> : "Connect a domain · All set"}
              </div>
              <button type="button" className="dlw-x" onClick={props.onClose} aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div style={{ display: "flex", gap: "0.35rem" }} aria-hidden="true">
              {stepList.map((s, i) => (
                <span key={s} style={{ flex: 1, height: 4, borderRadius: 4, background: !position || i + 1 <= position.n ? "var(--brand)" : "rgba(255,255,255,0.1)", transition: "background .2s" }} />
              ))}
            </div>
          </div>

          <div className="dlw-body">
            {body}
            {error && (
              <p role="alert" style={{ margin: 0, color: "#f87171", fontSize: "0.83rem", display: "flex", gap: "0.45rem", alignItems: "flex-start" }}><span style={{ marginTop: 1 }}><Cross /></span>{error}</p>
            )}
          </div>

          <div className="dlw-footer" style={{ padding: "0.9rem 1.6rem", borderTop: "1px solid rgba(255,255,255,0.07)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem" }}>
            {footer}
          </div>
        </div>
      </div>
    </>
  );
}
