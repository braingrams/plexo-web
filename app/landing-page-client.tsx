"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import {
  Sparkles, ArrowRight, LayoutTemplate, Code2, Bot, KeyRound, Webhook,
  Cpu, Check, Copy, ChevronDown, Monitor, Tablet, Smartphone,
} from "lucide-react";
import { Reveal, OpenReveal, useReducedMotion, gsap, useGSAP } from "./scroll-fx";

/* ─────────────────────────────────────────────────────────────
   HERO — interactive product mock, scales/fades away as you scroll past it
   ("scroll away to collapse").
   ───────────────────────────────────────────────────────────── */
const AI_TIERS = [
  { value: "AUTO", label: "Auto", desc: "System picks per task" },
  { value: "BASIC", label: "Fast", desc: "Quick, deterministic" },
  { value: "MEDIUM", label: "Balanced", desc: "Default creativity" },
  { value: "HIGH", label: "Creative", desc: "Exploratory, expressive" },
];

const VIEWPORTS = [
  { value: "desktop", icon: Monitor, width: "100%" },
  { value: "tablet", icon: Tablet, width: "78%" },
  { value: "mobile", icon: Smartphone, width: "38%" },
] as const;

export function HeroSection() {
  const heroRef = useRef<HTMLDivElement>(null);
  const mockRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const [viewport, setViewport] = useState<(typeof VIEWPORTS)[number]["value"]>("desktop");
  const [aiTier, setAiTier] = useState("AUTO");
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);

  useGSAP(
    () => {
      if (reducedMotion || !mockRef.current || !heroRef.current) return;
      gsap.to(mockRef.current, {
        scale: 0.88,
        opacity: 0,
        y: -30,
        ease: "none",
        scrollTrigger: {
          trigger: heroRef.current,
          start: "top top",
          end: "bottom top",
          scrub: true,
        },
      });
    },
    { scope: heroRef, dependencies: [reducedMotion] },
  );

  function handleGenerate() {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setTimeout(() => setGenerating(false), 1400);
  }

  return (
    <section id="studio" ref={heroRef} style={{ padding: "9rem 1.5rem 5rem", textAlign: "center", position: "relative", overflow: "hidden" }}>
      <div className="landing-container">
        <Reveal
          className="animate-fade-up"
          style={{
            display: "inline-flex", alignItems: "center", gap: "0.5rem",
            background: "var(--brand-subtle)", border: "1px solid var(--brand-glow)",
            borderRadius: 999, padding: "0.35rem 0.95rem", marginBottom: "1.75rem",
          }}
        >
          <Sparkles size={14} color="var(--brand)" />
          <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--brand)" }}>
            Visual Builder · React SDK · MCP Agent Protocol
          </span>
        </Reveal>

        <Reveal as="h1" delay={0.1} className="gradient-text" style={{
          fontFamily: "var(--font-heading), sans-serif",
          fontSize: "clamp(2.8rem, 6.5vw, 5.2rem)",
          fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.02,
          maxWidth: 900, margin: "0 auto 1.5rem",
        }}>
          Build visual pages.
          <br />
          Ship them anywhere.
        </Reveal>

        <Reveal as="p" delay={0.2} style={{
          fontSize: "clamp(1rem, 1.6vw, 1.2rem)", color: "var(--text-muted)",
          maxWidth: 620, margin: "0 auto 2.5rem", lineHeight: 1.65,
        }}>
          Design emails and landing pages visually, embed the builder into your own product with the React SDK,
          or let Claude, Cursor, and ChatGPT publish pages for you through the MCP agent protocol.
        </Reveal>

        <Reveal delay={0.3} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "1rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
          <Link href="/auth/register?plan=FREE" className="btn-brand" style={{ padding: "0.9rem 2.1rem", fontSize: "0.95rem" }}>
            Start Building Free
            <ArrowRight size={16} />
          </Link>
          <Link href="/sdk" className="btn-ghost" style={{ padding: "0.9rem 2.1rem", fontSize: "0.95rem" }}>
            Explore the SDK
          </Link>
        </Reveal>

        <Reveal delay={0.4} style={{ fontSize: "0.85rem", color: "var(--text-faint)", marginBottom: "3.5rem" }}>
          No credit card required on the Free plan.
        </Reveal>

        <div ref={mockRef} className="surface-card" style={{
          maxWidth: 960, margin: "0 auto", textAlign: "left", overflow: "hidden",
        }}>
          {/* window chrome */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "0.85rem 1.1rem", borderBottom: "1px solid var(--surface-border)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              {["#f87171", "#fbbf24", "#34d399"].map((c) => (
                <div key={c} style={{ width: 9, height: 9, borderRadius: "50%", background: c, opacity: 0.7 }} />
              ))}
            </div>
            <div style={{ display: "flex", gap: "0.35rem", background: "var(--surface)", padding: "0.2rem", borderRadius: 8 }}>
              {VIEWPORTS.map(({ value, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => setViewport(value)}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 26, height: 22, borderRadius: 6, border: "none", cursor: "pointer",
                    background: viewport === value ? "var(--brand)" : "transparent",
                    color: viewport === value ? "#fff" : "var(--text-muted)",
                  }}
                >
                  <Icon size={13} />
                </button>
              ))}
            </div>
            <span style={{ fontSize: "0.72rem", color: "var(--text-faint)", fontFamily: "var(--font-mono), monospace" }}>
              plexo.studio
            </span>
          </div>

          <div style={{ display: "flex" }}>
            <div style={{ flex: 1, padding: "1.5rem", display: "flex", justifyContent: "center", background: "var(--bg-1)" }}>
              <div style={{
                width: VIEWPORTS.find((v) => v.value === viewport)!.width, maxWidth: "100%",
                transition: "width 0.3s var(--ease-out)", borderRadius: 12, overflow: "hidden",
                border: "1px solid var(--surface-border)", background: "var(--bg)",
              }}>
                <div style={{ padding: "2rem 1.25rem", textAlign: "center" }}>
                  <div style={{ height: 14, width: "60%", margin: "0 auto 0.75rem", borderRadius: 4, background: "var(--brand-subtle)" }} />
                  <div style={{ height: 8, width: "80%", margin: "0 auto 1.5rem", borderRadius: 4, background: "var(--surface-border)" }} />
                  <div style={{ height: 34, width: "40%", margin: "0 auto", borderRadius: 8, background: "linear-gradient(135deg, var(--brand), var(--brand-deep))" }} />
                </div>
              </div>
            </div>

            <div style={{ width: 220, borderLeft: "1px solid var(--surface-border)", padding: "1.1rem", flexShrink: 0 }} className="hidden md:block">
              <p style={{ fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: "0.75rem" }}>
                AI Model Tier
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", marginBottom: "1.25rem" }}>
                {AI_TIERS.map((tier) => (
                  <button
                    key={tier.value}
                    onClick={() => setAiTier(tier.value)}
                    style={{
                      textAlign: "left", padding: "0.4rem 0.6rem", borderRadius: 7, border: "none", cursor: "pointer",
                      background: aiTier === tier.value ? "var(--brand-subtle)" : "transparent",
                      color: aiTier === tier.value ? "var(--brand)" : "var(--text-muted)",
                      fontSize: "0.78rem", fontWeight: 600,
                    }}
                  >
                    {tier.label}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: "0.4rem" }}>
                <input
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Describe a section…"
                  style={{
                    flex: 1, minWidth: 0, padding: "0.5rem 0.6rem", borderRadius: 7,
                    border: "1px solid var(--surface-border)", background: "var(--bg-1)",
                    color: "var(--text-main)", fontSize: "0.75rem", outline: "none",
                  }}
                />
              </div>
              <button
                onClick={handleGenerate}
                className="btn-brand"
                style={{ width: "100%", justifyContent: "center", marginTop: "0.5rem", padding: "0.5rem", fontSize: "0.78rem" }}
              >
                {generating ? "Generating…" : "Generate"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   LOGOS BAR
   ───────────────────────────────────────────────────────────── */
export function LogosBar() {
  const logos = ["React.js", "Next.js App Router", "Claude Desktop", "Cursor IDE", "ChatGPT", "Unsplash API"];
  return (
    <section style={{ padding: "2.5rem 1.5rem", borderTop: "1px solid var(--surface-border)", borderBottom: "1px solid var(--surface-border)" }}>
      <Reveal className="landing-container" style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        gap: "2.5rem", flexWrap: "wrap", fontSize: "0.85rem", fontWeight: 600, color: "var(--text-faint)",
      }}>
        {logos.map((logo, i) => (
          <span key={logo}>
            {logo}
            {i < logos.length - 1 && <span style={{ marginLeft: "2.5rem", opacity: 0.4 }}>·</span>}
          </span>
        ))}
      </Reveal>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   ECOSYSTEM — three pillars that scroll-scrub from a scattered stack into their
   final grid ("scroll to rearrange").
   ───────────────────────────────────────────────────────────── */
const ECOSYSTEM_CARDS = [
  {
    icon: LayoutTemplate,
    title: "Studio Platform",
    desc: "The visual drag-and-drop builder for email and landing page templates — compile to clean HTML, publish to a subdomain or your own custom domain, and track visits in real time.",
    color: "#8b5cf6",
  },
  {
    icon: Code2,
    title: "React SDK",
    desc: "@charisol/plexo-sdk drops the entire builder into your own product as a <PlexoBuilder /> component, with a ref-based exportDesign() API and server-proxied AI generation.",
    color: "#38bdf8",
  },
  {
    icon: Bot,
    title: "MCP Agent Protocol",
    desc: "@charisol/plexo-mcp exposes 17 purpose-built tools so Claude Desktop, Cursor, and ChatGPT can create, edit, and publish pages directly from a prompt.",
    color: "#34d399",
  },
];

export function EcosystemSection() {
  const containerRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useGSAP(
    () => {
      if (reducedMotion || !containerRef.current) return;
      const cards = gsap.utils.toArray<HTMLElement>(".ecosystem-card", containerRef.current);
      const offsets = [
        { x: 60, y: 70, rotate: -7 },
        { x: 0, y: -40, rotate: 0 },
        { x: -60, y: 70, rotate: 7 },
      ];
      cards.forEach((card, i) => {
        gsap.set(card, { x: offsets[i]?.x ?? 0, y: offsets[i]?.y ?? 0, rotate: offsets[i]?.rotate ?? 0, scale: 0.9, opacity: 0.35 });
      });
      gsap.to(cards, {
        x: 0, y: 0, rotate: 0, scale: 1, opacity: 1,
        stagger: 0.15,
        ease: "power2.out",
        scrollTrigger: {
          trigger: containerRef.current,
          start: "top 75%",
          end: "top 25%",
          scrub: 1,
        },
      });
    },
    { scope: containerRef, dependencies: [reducedMotion] },
  );

  return (
    <section id="features" className="landing-section">
      <div className="landing-container">
        <Reveal style={{ textAlign: "center", marginBottom: "4rem" }}>
          <p style={{ fontSize: "0.8rem", fontWeight: 700, letterSpacing: "0.1em", color: "var(--brand)", textTransform: "uppercase", marginBottom: "0.5rem" }}>
            One Ecosystem
          </p>
          <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "clamp(1.8rem, 3.5vw, 2.6rem)", fontWeight: 800, letterSpacing: "-0.025em", color: "var(--text-main)" }}>
            Three ways to build with Plexo
          </h2>
        </Reveal>

        <div ref={containerRef} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1.5rem" }}>
          {ECOSYSTEM_CARDS.map(({ icon: Icon, title, desc, color }) => (
            <div key={title} className="ecosystem-card surface-card" style={{ padding: "2rem" }}>
              <div style={{
                width: 42, height: 42, borderRadius: 12, background: `${color}1f`, border: `1px solid ${color}40`,
                display: "grid", placeItems: "center", marginBottom: "1.25rem",
              }}>
                <Icon size={20} color={color} />
              </div>
              <h3 style={{ fontSize: "1.15rem", fontWeight: 700, color: "var(--text-main)", marginBottom: "0.6rem" }}>{title}</h3>
              <p style={{ fontSize: "0.88rem", color: "var(--text-muted)", lineHeight: 1.6 }}>{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   AI, THREE WAYS
   ───────────────────────────────────────────────────────────── */
const AI_MODES = [
  {
    icon: Cpu,
    title: "System AI",
    desc: "Plexo's own credit ledger pays for generation — every plan gets a monthly allowance, with top-up packs that never expire.",
  },
  {
    icon: KeyRound,
    title: "Bring Your Own Key",
    desc: "Use your own OpenAI, Anthropic, or Gemini API key instead. Encrypted at rest with AES-256, and never touches Plexo's credit balance.",
  },
  {
    icon: Webhook,
    title: "Host-Managed (Ultra)",
    desc: "An embedding host app authorizes and bills its own end users for every AI action via HMAC-SHA256-signed webhooks — Plexo never sees or meters the request.",
  },
];

export function AiModesSection() {
  return (
    <section className="landing-section" style={{ paddingTop: "4rem", paddingBottom: "4rem" }}>
      <div className="landing-container">
        <Reveal style={{ textAlign: "center", marginBottom: "3.5rem" }}>
          <p style={{ fontSize: "0.8rem", fontWeight: 700, letterSpacing: "0.1em", color: "var(--brand)", textTransform: "uppercase", marginBottom: "0.5rem" }}>
            Flexible By Design
          </p>
          <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "clamp(1.6rem, 3vw, 2.2rem)", fontWeight: 800, letterSpacing: "-0.025em", color: "var(--text-main)" }}>
            AI generation, three ways
          </h2>
        </Reveal>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1.25rem" }}>
          {AI_MODES.map(({ icon: Icon, title, desc }, i) => (
            <Reveal key={title} delay={i * 0.1} className="surface-card" style={{ padding: "1.75rem" }}>
              <Icon size={22} color="var(--brand)" style={{ marginBottom: "1rem" }} />
              <h3 style={{ fontSize: "1.02rem", fontWeight: 700, color: "var(--text-main)", marginBottom: "0.5rem" }}>{title}</h3>
              <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", lineHeight: 1.6 }}>{desc}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   CODE PLAYGROUND — "scroll in to open"
   ───────────────────────────────────────────────────────────── */
const CODE_TABS = [
  {
    id: "react",
    label: "React / Vite",
    code: `import { PlexoBuilder } from "@charisol/plexo-sdk";

export default function Editor() {
  return (
    <PlexoBuilder
      mode="landing_page"
      apiKey={process.env.PLEXO_API_KEY}
      useAi
    />
  );
}`,
  },
  {
    id: "nextjs",
    label: "Next.js App Router",
    code: `"use client";
import dynamic from "next/dynamic";

const PlexoBuilder = dynamic(
  () => import("@charisol/plexo-sdk").then((m) => m.PlexoBuilder),
  { ssr: false }
);

export default function Editor() {
  return <PlexoBuilder mode="email" apiKey={process.env.NEXT_PUBLIC_PLEXO_KEY} />;
}`,
  },
  {
    id: "mcp",
    label: "Claude Desktop (MCP)",
    code: `{
  "mcpServers": {
    "plexo": {
      "command": "npx",
      "args": ["-y", "@charisol/plexo-mcp"],
      "env": { "PLEXO_API_KEY": "your-api-key" }
    }
  }
}`,
  },
  {
    id: "webhook",
    label: "Host Webhook",
    code: `POST /your-endpoint/ai-authorize
X-Plexo-Signature: sha256=...

{
  "userId": "end-user-123",
  "action": "generate_section",
  "timestamp": 1732900000
}`,
  },
];

export function CodePlayground() {
  const [activeTab, setActiveTab] = useState(CODE_TABS[0].id);
  const [copied, setCopied] = useState(false);
  const active = CODE_TABS.find((t) => t.id === activeTab)!;

  function copyCode() {
    navigator.clipboard.writeText(active.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section className="landing-section">
      <div className="landing-container" style={{ maxWidth: 900 }}>
        <Reveal style={{ textAlign: "center", marginBottom: "3rem" }}>
          <p style={{ fontSize: "0.8rem", fontWeight: 700, letterSpacing: "0.1em", color: "var(--brand)", textTransform: "uppercase", marginBottom: "0.5rem" }}>
            Built For Developers
          </p>
          <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "clamp(1.8rem, 3.5vw, 2.4rem)", fontWeight: 800, letterSpacing: "-0.025em", color: "var(--text-main)" }}>
            Drop it into anything
          </h2>
        </Reveal>

        <OpenReveal className="surface-card" style={{ overflow: "hidden" }}>
          <div style={{ display: "flex", borderBottom: "1px solid var(--surface-border)", overflowX: "auto" }}>
            {CODE_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: "0.9rem 1.25rem", fontSize: "0.82rem", fontWeight: 600, whiteSpace: "nowrap",
                  border: "none", cursor: "pointer", background: "transparent",
                  color: activeTab === tab.id ? "var(--brand)" : "var(--text-muted)",
                  borderBottom: activeTab === tab.id ? "2px solid var(--brand)" : "2px solid transparent",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div style={{ position: "relative" }}>
            <button
              onClick={copyCode}
              style={{
                position: "absolute", top: "1rem", right: "1rem", display: "flex", alignItems: "center", gap: "0.35rem",
                padding: "0.4rem 0.7rem", borderRadius: 7, border: "1px solid var(--surface-border)",
                background: "var(--surface)", color: "var(--text-muted)", fontSize: "0.75rem", cursor: "pointer",
              }}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? "Copied" : "Copy"}
            </button>
            <pre style={{
              margin: 0, padding: "1.5rem", overflowX: "auto", fontSize: "0.82rem", lineHeight: 1.7,
              fontFamily: "var(--font-mono), monospace", color: "var(--text-main)",
            }}>
              <code>{active.code}</code>
            </pre>
          </div>
        </OpenReveal>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   PRICING
   ───────────────────────────────────────────────────────────── */
const PLANS = [
  {
    name: "Free",
    planId: "FREE" as const,
    price: "$0",
    period: "forever",
    description: "For individuals getting started with email templates.",
    features: ["3 Saved Templates", "Email Template Builder", "Drag-and-Drop Editor", "HTML & JSON Export", "1 API Key"],
    cta: "Get Started Free",
    highlight: false,
  },
  {
    name: "Pro",
    planId: "PRO" as const,
    price: "$19",
    period: "/month",
    description: "For creators and small teams shipping landing pages.",
    features: [
      "20 Templates", "Email + Landing Pages", "10 Published Domains", "Custom Domain Support",
      "Remove Plexo Branding", "BYOK Encryption Vault", "MCP Server Access", "Strata Design Tokens", "3 API Keys",
    ],
    cta: "Start with Pro",
    highlight: true,
  },
  {
    name: "Ultra",
    planId: "ULTRA" as const,
    price: "$49",
    period: "/month",
    description: "For agencies and SaaS apps embedding Plexo for end users.",
    features: [
      "Unlimited Templates", "Unlimited Multi-Page Sites", "25 Published Domains", "Host-Managed AI Webhooks",
      "White-Glove SDK Embedding", "5,000 Monthly AI Credits", "10 API Keys", "Everything in Pro",
    ],
    cta: "Get Ultra",
    highlight: false,
  },
];

export function PricingSection() {
  return (
    <section id="pricing" className="landing-section">
      <div className="landing-container" style={{ maxWidth: 1100 }}>
        <Reveal style={{ textAlign: "center", marginBottom: "3.5rem" }}>
          <p style={{ fontSize: "0.8rem", fontWeight: 700, letterSpacing: "0.1em", color: "var(--brand)", textTransform: "uppercase", marginBottom: "0.5rem" }}>
            Transparent Pricing
          </p>
          <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "clamp(1.8rem, 3.5vw, 2.6rem)", fontWeight: 800, letterSpacing: "-0.025em", color: "var(--text-main)" }}>
            Simple, predictable plans
          </h2>
        </Reveal>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1.5rem" }}>
          {PLANS.map((plan, i) => (
            <Reveal
              key={plan.name}
              delay={i * 0.1}
              className="surface-card"
              style={{
                padding: "2rem", display: "flex", flexDirection: "column",
                borderColor: plan.highlight ? "var(--brand-glow)" : undefined,
                background: plan.highlight ? "var(--brand-subtle)" : undefined,
              }}
            >
              <h3 style={{ fontSize: "1.2rem", fontWeight: 800, color: "var(--text-main)", marginBottom: "0.3rem" }}>{plan.name}</h3>
              <p style={{ fontSize: "0.825rem", color: "var(--text-muted)", marginBottom: "1.25rem" }}>{plan.description}</p>
              <div style={{ display: "flex", alignItems: "baseline", gap: "0.2rem", marginBottom: "1.5rem" }}>
                <span style={{ fontSize: "2.5rem", fontWeight: 800, color: plan.highlight ? "var(--brand)" : "var(--text-main)", lineHeight: 1 }}>
                  {plan.price}
                </span>
                <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>{plan.period}</span>
              </div>
              <ul style={{ listStyle: "none", padding: 0, margin: "0 0 1.75rem", display: "flex", flexDirection: "column", gap: "0.6rem", flex: 1 }}>
                {plan.features.map((f) => (
                  <li key={f} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem", color: "var(--text-main)" }}>
                    <Check size={15} color={plan.highlight ? "var(--brand)" : "#34d399"} style={{ flexShrink: 0 }} />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href={`/auth/register?plan=${plan.planId}`}
                className={plan.highlight ? "btn-brand" : "btn-ghost"}
                style={{ textAlign: "center", justifyContent: "center", width: "100%" }}
              >
                {plan.cta}
              </Link>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   FAQ — "scroll in to open" panels that also expand/collapse on click.
   ───────────────────────────────────────────────────────────── */
const FAQS = [
  {
    q: "How does the React SDK work?",
    a: "Install @charisol/plexo-sdk and drop the <PlexoBuilder /> component into any React app. It renders the full drag-and-drop editor, and a ref-based exportDesign() call returns compiled HTML whenever you need it — you own the output.",
  },
  {
    q: "What can the MCP server actually do?",
    a: "@charisol/plexo-mcp exposes 17 tools covering template and landing page creation, multi-page site management, publishing, analytics, and account limits — so Claude Desktop, Cursor, or ChatGPT can build and ship a page end-to-end from a single prompt.",
  },
  {
    q: "Is Bring-Your-Own-Key actually secure?",
    a: "Yes — provider keys (OpenAI, Anthropic, Gemini) are encrypted at rest with AES-256 and are never echoed back to the client after saving. Requests are proxied server-side, so your key never reaches the browser.",
  },
  {
    q: "What's Host-Managed AI, and who needs it?",
    a: "It's an Ultra-only mode for platforms embedding Plexo for their own end users: your app authorizes and bills every AI action via an HMAC-SHA256-signed webhook, so Plexo never touches its own credit ledger for those requests and never sees your billing model.",
  },
];

export function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="faq" className="landing-section">
      <div className="landing-container" style={{ maxWidth: 780 }}>
        <Reveal style={{ textAlign: "center", marginBottom: "3rem" }}>
          <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: "clamp(1.8rem, 3.5vw, 2.4rem)", fontWeight: 800, letterSpacing: "-0.025em", color: "var(--text-main)" }}>
            Frequently asked questions
          </h2>
        </Reveal>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {FAQS.map((faq, i) => {
            const isOpen = openIndex === i;
            return (
              <OpenReveal key={faq.q} delay={i * 0.05} className="surface-card" style={{ padding: 0, overflow: "hidden" }}>
                <button
                  onClick={() => setOpenIndex(isOpen ? null : i)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "1.25rem 1.5rem", background: "none", border: "none", cursor: "pointer",
                    textAlign: "left", fontSize: "0.95rem", fontWeight: 700, color: "var(--text-main)",
                  }}
                >
                  {faq.q}
                  <ChevronDown
                    size={18}
                    color="var(--text-muted)"
                    style={{ flexShrink: 0, transition: "transform 0.25s var(--ease-out)", transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                  />
                </button>
                <div style={{
                  maxHeight: isOpen ? 240 : 0, overflow: "hidden",
                  transition: "max-height 0.3s var(--ease-out)",
                }}>
                  <p style={{ padding: "0 1.5rem 1.25rem", fontSize: "0.88rem", color: "var(--text-muted)", lineHeight: 1.65 }}>
                    {faq.a}
                  </p>
                </div>
              </OpenReveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
