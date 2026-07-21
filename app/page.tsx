import Link from "next/link";

/* ─── Inline SVG Icons ─────────────────────── */
function IconMail() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="3" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function IconLayout() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M3 9h18M9 21V9" />
    </svg>
  );
}

function IconSparkles() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275Z" />
    </svg>
  );
}

function IconKey() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3" />
    </svg>
  );
}

function IconExport() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function IconPalette() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function IconArrowRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  );
}

function PlexoLogo() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", textDecoration: "none" }}>
      <div style={{
        width: 34, height: 34, borderRadius: 9,
        background: "linear-gradient(135deg, #8b5cf6, #7c3aed)",
        display: "grid", placeItems: "center",
        boxShadow: "0 0 20px rgba(139,92,246,0.45)",
        flexShrink: 0,
      }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M12 2L4 7v5c0 4.97 3.35 9.63 8 10.93C17.65 21.63 21 16.97 21 12V7L12 2z" fill="white" opacity="0.9" />
          <path d="M9 12l2 2 4-4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <span style={{
        fontFamily: "var(--font-heading), sans-serif",
        fontWeight: 700, fontSize: "1.15rem",
        color: "#f0f2ff", letterSpacing: "-0.02em",
      }}>Plexo</span>
    </div>
  );
}

/* ─── Feature Cards Data ───────────────────── */
const features = [
  {
    icon: <IconMail />,
    title: "Email Builder",
    description: "Design pixel-perfect email campaigns with drag-and-drop precision. Export battle-tested HTML.",
    color: "#8b5cf6",
  },
  {
    icon: <IconLayout />,
    title: "Landing Pages",
    description: "Build responsive landing pages that convert. Full layout control without writing code.",
    color: "#818cf8",
  },
  {
    icon: <IconSparkles />,
    title: "AI Assistance",
    description: "Generate content, suggest layouts, and speed up your workflow with intelligent AI suggestions.",
    color: "#34d399",
  },
  {
    icon: <IconKey />,
    title: "API Keys",
    description: "Secure API access management. Configure AI providers and creativity tiers per key.",
    color: "#f59e0b",
  },
  {
    icon: <IconExport />,
    title: "Export Ready",
    description: "One-click export to clean HTML, plain text, or structured JSON for any platform.",
    color: "#38bdf8",
  },
  {
    icon: <IconPalette />,
    title: "Design Tokens",
    description: "Full theme customization with Strata token support. Your brand, perfectly consistent.",
    color: "#c084fc",
  },
];

const steps = [
  {
    number: "01",
    title: "Create a Template",
    description: "Start with a blank canvas or choose from pre-built structures. Name it and pick your type.",
  },
  {
    number: "02",
    title: "Design Visually",
    description: "Drag blocks, style elements, and add content using the intuitive Plexo Builder interface.",
  },
  {
    number: "03",
    title: "Export & Deploy",
    description: "Save your work and export clean, production-ready HTML to any email platform or website.",
  },
];

const plans = [
  {
    name: "Starter",
    price: "Free",
    period: "",
    description: "Perfect for individuals just getting started.",
    features: ["5 Templates", "Email Builder", "HTML Export", "Community Support"],
    cta: "Get Started Free",
    highlight: false,
  },
  {
    name: "Pro",
    price: "$19",
    period: "/mo",
    description: "For creators and small teams who move fast.",
    features: ["Unlimited Templates", "Email + Landing Pages", "AI Assistance", "API Key Access", "Priority Support"],
    cta: "Start Pro Trial",
    highlight: true,
  },
  {
    name: "Ultra",
    price: "$49",
    period: "/mo",
    description: "Maximum power for agencies and enterprises.",
    features: ["Everything in Pro", "Custom AI Models", "Strata Token System", "White-label Export", "Dedicated Support"],
    cta: "Contact Sales",
    highlight: false,
  },
];

export default function HomePage() {
  return (
    <>
      {/* ── NAVBAR ─────────────────────────────────── */}
      <header style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
        padding: "0 1.5rem",
        height: 64,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "rgba(8,9,15,0.85)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
      }}>
        <Link href="/" style={{ textDecoration: "none" }}>
          <PlexoLogo />
        </Link>

        <nav style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
          {["Features", "How It Works", "Pricing"].map((item) => (
            <a
              key={item}
              href={`#${item.toLowerCase().replace(/\s+/g, "-")}`}
              style={{
                padding: "0.4rem 0.85rem",
                borderRadius: 8,
                fontSize: "0.875rem",
                fontWeight: 500,
                color: "rgba(240,242,255,0.7)",
                textDecoration: "none",
                transition: "color 0.15s, background 0.15s",
              }}
            >
              {item}
            </a>
          ))}
          <Link
            href="/sdk"
            style={{
              padding: "0.4rem 0.85rem",
              borderRadius: 8,
              fontSize: "0.875rem",
              fontWeight: 500,
              color: "rgba(240,242,255,0.7)",
              textDecoration: "none",
              transition: "color 0.15s, background 0.15s",
            }}
          >
            SDK
          </Link>
        </nav>

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <Link href="/auth/login" style={{
            padding: "0.5rem 1rem",
            borderRadius: 9,
            fontSize: "0.875rem",
            fontWeight: 600,
            color: "rgba(240,242,255,0.8)",
            textDecoration: "none",
            border: "1px solid rgba(255,255,255,0.1)",
            transition: "background 0.15s",
          }}>
            Sign In
          </Link>
          <Link href="/auth/register" className="btn-brand" style={{ padding: "0.5rem 1.1rem", fontSize: "0.875rem" }}>
            Get Started
          </Link>
        </div>
      </header>

      <main style={{ paddingTop: 64 }}>

        {/* ── HERO ────────────────────────────────────── */}
        <section id="hero" style={{
          padding: "8rem 1.5rem 6rem",
          textAlign: "center",
          position: "relative",
          overflow: "hidden",
        }}>
          {/* Orbs */}
          <div aria-hidden style={{
            position: "absolute", top: "10%", left: "15%",
            width: 500, height: 500, borderRadius: "50%",
            background: "radial-gradient(circle, rgba(139,92,246,0.18) 0%, transparent 70%)",
            filter: "blur(40px)",
            animation: "orb-float 12s ease-in-out infinite",
            pointerEvents: "none",
          }} />
          <div aria-hidden style={{
            position: "absolute", top: "20%", right: "10%",
            width: 400, height: 400, borderRadius: "50%",
            background: "radial-gradient(circle, rgba(100,50,255,0.14) 0%, transparent 70%)",
            filter: "blur(50px)",
            animation: "orb-float 15s ease-in-out infinite reverse",
            pointerEvents: "none",
          }} />

          <div className="landing-container" style={{ position: "relative" }}>
            {/* Eyebrow */}
            <div className="animate-fade-up" style={{
              display: "inline-flex", alignItems: "center", gap: "0.5rem",
              background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.25)",
              borderRadius: 999, padding: "0.3rem 0.9rem 0.3rem 0.5rem",
              marginBottom: "1.75rem",
            }}>
              <span style={{
                background: "linear-gradient(135deg,#8b5cf6,#7c3aed)",
                borderRadius: 999, width: 18, height: 18,
                display: "grid", placeItems: "center",
              }}>
                <IconSparkles />
              </span>
              <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#8b5cf6" }}>
                AI-Powered Template Builder
              </span>
            </div>

            {/* Headline */}
            <h1 className="animate-fade-up delay-100" style={{
              fontFamily: "var(--font-heading), sans-serif",
              fontSize: "clamp(2.6rem, 6vw, 5rem)",
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: "-0.03em",
              color: "#f0f2ff",
              maxWidth: 820,
              margin: "0 auto 1.5rem",
            }}>
              Build beautiful emails{" "}
              <span style={{
                background: "linear-gradient(135deg,#8b5cf6 0%,#7c3aed 50%,#818cf8 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}>
                & landing pages
              </span>
              {" "}visually.
            </h1>

            {/* Subtext */}
            <p className="animate-fade-up delay-200" style={{
              fontSize: "clamp(1rem, 2vw, 1.2rem)",
              color: "rgba(240,242,255,0.6)",
              maxWidth: 580,
              margin: "0 auto 2.5rem",
              lineHeight: 1.65,
            }}>
              Plexo is the professional template builder for modern teams. Drag-and-drop, AI-assisted, export-ready — designed for speed and results.
            </p>

            {/* CTAs */}
            <div className="animate-fade-up delay-300" style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              gap: "1rem", flexWrap: "wrap",
            }}>
              <Link href="/auth/register" className="btn-brand" style={{ padding: "0.85rem 2rem", fontSize: "1rem" }}>
                Start Building Free
                <IconArrowRight />
              </Link>
              <Link href="/auth/login" className="btn-ghost" style={{ padding: "0.85rem 2rem", fontSize: "1rem" }}>
                Sign In
              </Link>
            </div>

            {/* Social proof */}
            <div className="animate-fade-up delay-400" style={{
              marginTop: "2.5rem", display: "flex", alignItems: "center",
              justifyContent: "center", gap: "1.5rem", flexWrap: "wrap",
            }}>
              {["No credit card required", "Free plan available", "Export-ready HTML"].map((item) => (
                <span key={item} style={{
                  display: "flex", alignItems: "center", gap: "0.35rem",
                  fontSize: "0.82rem", color: "rgba(240,242,255,0.5)",
                }}>
                  <span style={{ color: "#34d399" }}><IconCheck /></span>
                  {item}
                </span>
              ))}
            </div>

            {/* App mockup window */}
            <div className="animate-fade-up delay-500" style={{
              marginTop: "4rem",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 20,
              overflow: "hidden",
              boxShadow: "0 40px 120px rgba(0,0,0,0.7), 0 0 0 1px rgba(139,92,246,0.08), 0 0 60px rgba(139,92,246,0.05)",
              maxWidth: 900,
              margin: "4rem auto 0",
            }}>
              {/* Window chrome */}
              <div style={{
                display: "flex", alignItems: "center", gap: "0.5rem",
                padding: "0.75rem 1rem",
                borderBottom: "1px solid rgba(255,255,255,0.07)",
                background: "rgba(255,255,255,0.02)",
              }}>
                {["#f87171","#fbbf24","#34d399"].map((c) => (
                  <div key={c} style={{ width: 10, height: 10, borderRadius: "50%", background: c, opacity: 0.7 }} />
                ))}
                <div style={{
                  flex: 1, margin: "0 0.75rem",
                  background: "rgba(255,255,255,0.04)",
                  borderRadius: 6, height: 22,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <span style={{ fontSize: "0.7rem", color: "rgba(240,242,255,0.3)" }}>app.plexo.dev/dashboard/templates</span>
                </div>
              </div>
              {/* Mock builder content */}
              <div style={{ display: "flex", height: 380 }}>
                {/* Sidebar mock */}
                <div style={{
                  width: 200, borderRight: "1px solid rgba(255,255,255,0.06)",
                  padding: "1rem 0.75rem",
                  background: "rgba(8,9,15,0.5)",
                }}>
                  <div style={{ marginBottom: "1rem" }}>
                    <div style={{ height: 8, borderRadius: 4, background: "rgba(139,92,246,0.3)", width: "60%", marginBottom: 6 }} />
                    <div style={{ height: 6, borderRadius: 4, background: "rgba(255,255,255,0.06)", width: "80%" }} />
                  </div>
                  {[...Array(5)].map((_, i) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", gap: "0.5rem",
                      padding: "0.5rem 0.6rem", borderRadius: 8, marginBottom: 4,
                      background: i === 0 ? "rgba(139,92,246,0.1)" : "transparent",
                    }}>
                      <div style={{
                        width: 20, height: 20, borderRadius: 5,
                        background: i === 0 ? "rgba(139,92,246,0.4)" : "rgba(255,255,255,0.06)",
                        flexShrink: 0,
                      }} />
                      <div style={{
                        height: 7, borderRadius: 4,
                        background: i === 0 ? "rgba(139,92,246,0.5)" : "rgba(255,255,255,0.08)",
                        width: `${[70,55,65,50,60][i]}%`,
                      }} />
                    </div>
                  ))}
                </div>
                {/* Canvas mock */}
                <div style={{ flex: 1, padding: "1.5rem", background: "rgba(10,11,20,0.4)" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" }}>
                    {[...Array(6)].map((_, i) => (
                      <div key={i} style={{
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.07)",
                        borderRadius: 12, padding: "1rem",
                        height: 120,
                      }}>
                        <div style={{ height: 8, borderRadius: 4, background: i % 3 === 0 ? "rgba(139,92,246,0.3)" : "rgba(255,255,255,0.06)", width: "40%", marginBottom: 8 }} />
                        <div style={{ height: 6, borderRadius: 4, background: "rgba(255,255,255,0.05)", width: "80%", marginBottom: 5 }} />
                        <div style={{ height: 6, borderRadius: 4, background: "rgba(255,255,255,0.04)", width: "60%", marginBottom: 16 }} />
                        <div style={{ height: 28, borderRadius: 7, background: i % 2 === 0 ? "rgba(139,92,246,0.2)" : "rgba(255,255,255,0.04)", border: `1px solid ${i % 2 === 0 ? "rgba(139,92,246,0.2)" : "rgba(255,255,255,0.07)"}` }} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── FEATURES ─────────────────────────────── */}
        <section id="features" className="landing-section">
          <div className="landing-container">
            <div style={{ textAlign: "center", marginBottom: "3.5rem" }}>
              <p style={{ fontSize: "0.8rem", fontWeight: 700, letterSpacing: "0.12em", color: "#8b5cf6", textTransform: "uppercase", marginBottom: "0.75rem" }}>
                Features
              </p>
              <h2 style={{
                fontFamily: "var(--font-heading), sans-serif",
                fontSize: "clamp(1.8rem, 4vw, 2.8rem)",
                fontWeight: 800, letterSpacing: "-0.025em",
                color: "#f0f2ff", lineHeight: 1.15,
              }}>
                Everything you need to build fast
              </h2>
              <p style={{ color: "rgba(240,242,255,0.5)", fontSize: "1rem", marginTop: "0.75rem", maxWidth: 500, margin: "0.75rem auto 0" }}>
                A complete toolkit for designing, building, and exporting professional templates.
              </p>
            </div>

            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: "1.25rem",
            }}>
              {features.map((feature) => (
                <div
                  key={feature.title}
                  className="glass-card glass-card-hover"
                  style={{ padding: "1.75rem" }}
                >
                  <div style={{
                    width: 44, height: 44, borderRadius: 12,
                    background: `${feature.color}18`,
                    border: `1px solid ${feature.color}30`,
                    display: "grid", placeItems: "center",
                    color: feature.color,
                    marginBottom: "1rem",
                  }}>
                    {feature.icon}
                  </div>
                  <h3 style={{
                    fontFamily: "var(--font-heading), sans-serif",
                    fontSize: "1.05rem", fontWeight: 700,
                    color: "#f0f2ff", marginBottom: "0.5rem",
                  }}>
                    {feature.title}
                  </h3>
                  <p style={{ fontSize: "0.875rem", color: "rgba(240,242,255,0.55)", lineHeight: 1.6 }}>
                    {feature.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── HOW IT WORKS ─────────────────────────── */}
        <section id="how-it-works" className="landing-section" style={{
          background: "rgba(255,255,255,0.015)",
          borderTop: "1px solid rgba(255,255,255,0.05)",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
        }}>
          <div className="landing-container">
            <div style={{ textAlign: "center", marginBottom: "3.5rem" }}>
              <p style={{ fontSize: "0.8rem", fontWeight: 700, letterSpacing: "0.12em", color: "#8b5cf6", textTransform: "uppercase", marginBottom: "0.75rem" }}>
                How It Works
              </p>
              <h2 style={{
                fontFamily: "var(--font-heading), sans-serif",
                fontSize: "clamp(1.8rem, 4vw, 2.8rem)",
                fontWeight: 800, letterSpacing: "-0.025em",
                color: "#f0f2ff",
              }}>
                From idea to launch in minutes
              </h2>
            </div>

            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: "2rem",
              position: "relative",
            }}>
              {steps.map((step, i) => (
                <div key={step.number} style={{ textAlign: "center", padding: "0 1rem" }}>
                  <div style={{
                    width: 60, height: 60, borderRadius: 16,
                    background: i === 1 ? "linear-gradient(135deg,#8b5cf6,#7c3aed)" : "rgba(255,255,255,0.05)",
                    border: i === 1 ? "none" : "1px solid rgba(255,255,255,0.1)",
                    display: "grid", placeItems: "center",
                    margin: "0 auto 1.25rem",
                    boxShadow: i === 1 ? "0 8px 32px rgba(139,92,246,0.4)" : "none",
                  }}>
                    <span style={{
                      fontFamily: "var(--font-heading), sans-serif",
                      fontWeight: 800, fontSize: "1.1rem",
                      color: i === 1 ? "#fff" : "#7b83a6",
                    }}>
                      {step.number}
                    </span>
                  </div>
                  <h3 style={{
                    fontFamily: "var(--font-heading), sans-serif",
                    fontSize: "1.1rem", fontWeight: 700,
                    color: "#f0f2ff", marginBottom: "0.6rem",
                  }}>
                    {step.title}
                  </h3>
                  <p style={{ fontSize: "0.875rem", color: "rgba(240,242,255,0.5)", lineHeight: 1.65 }}>
                    {step.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── DEVELOPER SDK SECTION ────────────────── */}
        <section id="developer-sdk" className="landing-section" style={{
          background: "rgba(255,255,255,0.005)",
          borderBottom: "1px solid rgba(255,255,255,0.04)",
        }}>
          <div className="landing-container" style={{
            display: "grid", gridTemplateColumns: "1fr", gap: "3rem", alignItems: "center",
          }}>
            {/* Split layout on wider screens */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: "3rem",
              alignItems: "center",
            }}>
              <div>
                <p style={{ fontSize: "0.8rem", fontWeight: 700, letterSpacing: "0.12em", color: "#8b5cf6", textTransform: "uppercase", marginBottom: "0.75rem" }}>
                  Developer First
                </p>
                <h2 style={{
                  fontFamily: "var(--font-heading), sans-serif",
                  fontSize: "clamp(1.8rem, 4vw, 2.8rem)",
                  fontWeight: 800, letterSpacing: "-0.025em",
                  color: "#f0f2ff", lineHeight: 1.15,
                  marginBottom: "1rem",
                }}>
                  Fully Embeddable Visual SDK
                </h2>
                <p style={{ color: "rgba(240,242,255,0.55)", fontSize: "1rem", lineHeight: 1.65, marginBottom: "1.5rem" }}>
                  Integrate Plexo's premium drag-and-drop template builder directly into your own SaaS dashboard. Give your users visual design tools without building them from scratch.
                </p>
                
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "2rem" }}>
                  {[
                    "React builder component with custom themes",
                    "Compile designs to responsive HTML on the server",
                    "Configure AI provider routing using API keys",
                  ].map((item, index) => (
                    <div key={index} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span style={{ color: "#8b5cf6", display: "inline-flex" }}>
                        <IconCheck />
                      </span>
                      <span style={{ fontSize: "0.875rem", color: "rgba(240,242,255,0.75)" }}>{item}</span>
                    </div>
                  ))}
                </div>

                <Link href="/sdk" className="btn-brand" style={{ padding: "0.75rem 1.75rem" }}>
                  Explore SDK Docs
                  <IconArrowRight />
                </Link>
              </div>

              {/* Code window mock */}
              <div style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 16,
                overflow: "hidden",
                boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
              }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: "0.4rem",
                  padding: "0.6rem 0.9rem",
                  borderBottom: "1px solid rgba(255,255,255,0.06)",
                  background: "rgba(255,255,255,0.01)",
                }}>
                  {["#f87171","#fbbf24","#34d399"].map((c) => (
                    <div key={c} style={{ width: 8, height: 8, borderRadius: "50%", background: c, opacity: 0.6 }} />
                  ))}
                  <span style={{ fontSize: "0.7rem", color: "rgba(240,242,255,0.3)", marginLeft: "0.5rem", fontFamily: "monospace" }}>
                    MyBuilderComponent.tsx
                  </span>
                </div>
                <pre style={{
                  padding: "1rem 1.25rem", margin: 0,
                  fontFamily: "monospace", fontSize: "0.75rem",
                  color: "rgba(240,242,255,0.8)", overflowX: "auto",
                  lineHeight: 1.5, background: "rgba(0,0,0,0.2)",
                }}>
{`// Install the visual builder engine
npm install @charisol/plexo-sdk

// Embed in any React page
import { PlexoBuilder } from '@charisol/plexo-sdk';

export default function Editor() {
  return (
    <PlexoBuilder
      apiKey="pk_live_yourkey..."
      mode="email"
      themeBgColor="#8b5cf6"
      useAi={true}
    />
  );
}`}
                </pre>
              </div>
            </div>
          </div>
        </section>

        {/* ── PRICING ──────────────────────────────── */}
        <section id="pricing" className="landing-section">
          <div className="landing-container">
            <div style={{ textAlign: "center", marginBottom: "3.5rem" }}>
              <p style={{ fontSize: "0.8rem", fontWeight: 700, letterSpacing: "0.12em", color: "#8b5cf6", textTransform: "uppercase", marginBottom: "0.75rem" }}>
                Pricing
              </p>
              <h2 style={{
                fontFamily: "var(--font-heading), sans-serif",
                fontSize: "clamp(1.8rem, 4vw, 2.8rem)",
                fontWeight: 800, letterSpacing: "-0.025em",
                color: "#f0f2ff",
              }}>
                Simple, transparent pricing
              </h2>
              <p style={{ color: "rgba(240,242,255,0.5)", fontSize: "1rem", marginTop: "0.75rem" }}>
                Start free, scale as you grow. No surprises.
              </p>
            </div>

            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: "1.25rem",
              alignItems: "start",
            }}>
              {plans.map((plan) => (
                <div
                  key={plan.name}
                  style={{
                    background: plan.highlight ? "rgba(139,92,246,0.06)" : "rgba(255,255,255,0.03)",
                    border: plan.highlight ? "1px solid rgba(139,92,246,0.35)" : "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 18,
                    padding: "2rem",
                    position: "relative",
                    boxShadow: plan.highlight ? "0 0 50px rgba(139,92,246,0.12), 0 20px 60px rgba(0,0,0,0.4)" : "0 10px 40px rgba(0,0,0,0.3)",
                  }}
                >
                  {plan.highlight && (
                    <div style={{
                      position: "absolute", top: -14, left: "50%",
                      transform: "translateX(-50%)",
                      background: "linear-gradient(135deg,#8b5cf6,#7c3aed)",
                      borderRadius: 999, padding: "0.25rem 1rem",
                      fontSize: "0.75rem", fontWeight: 700, color: "#fff",
                      letterSpacing: "0.05em", whiteSpace: "nowrap",
                      boxShadow: "0 4px 16px rgba(139,92,246,0.4)",
                    }}>
                      MOST POPULAR
                    </div>
                  )}
                  <h3 style={{
                    fontFamily: "var(--font-heading), sans-serif",
                    fontSize: "1.1rem", fontWeight: 700,
                    color: "#f0f2ff", marginBottom: "0.5rem",
                  }}>
                    {plan.name}
                  </h3>
                  <div style={{ display: "flex", alignItems: "baseline", gap: "0.2rem", marginBottom: "0.5rem" }}>
                    <span style={{
                      fontFamily: "var(--font-heading), sans-serif",
                      fontSize: "2.5rem", fontWeight: 800,
                      color: plan.highlight ? "#8b5cf6" : "#f0f2ff",
                    }}>
                      {plan.price}
                    </span>
                    {plan.period && (
                      <span style={{ color: "#7b83a6", fontSize: "0.9rem" }}>{plan.period}</span>
                    )}
                  </div>
                  <p style={{ fontSize: "0.85rem", color: "rgba(240,242,255,0.5)", marginBottom: "1.5rem" }}>
                    {plan.description}
                  </p>
                  <ul style={{ listStyle: "none", marginBottom: "1.75rem" }}>
                    {plan.features.map((f) => (
                      <li key={f} style={{
                        display: "flex", alignItems: "center", gap: "0.6rem",
                        padding: "0.45rem 0",
                        fontSize: "0.875rem", color: "rgba(240,242,255,0.75)",
                        borderBottom: "1px solid rgba(255,255,255,0.04)",
                      }}>
                        <span style={{ color: plan.highlight ? "#8b5cf6" : "#34d399", flexShrink: 0 }}>
                          <IconCheck />
                        </span>
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/auth/register"
                    style={{
                      display: "block", textAlign: "center",
                      padding: "0.75rem",
                      borderRadius: 11,
                      fontWeight: 700, fontSize: "0.875rem",
                      textDecoration: "none",
                      background: plan.highlight ? "linear-gradient(135deg,#8b5cf6,#7c3aed)" : "rgba(255,255,255,0.06)",
                      color: plan.highlight ? "#fff" : "rgba(240,242,255,0.8)",
                      border: plan.highlight ? "none" : "1px solid rgba(255,255,255,0.1)",
                      boxShadow: plan.highlight ? "0 4px 24px rgba(139,92,246,0.35)" : "none",
                      transition: "opacity 0.15s, box-shadow 0.15s",
                    }}
                  >
                    {plan.cta}
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA BANNER ───────────────────────────── */}
        <section style={{
          padding: "5rem 1.5rem",
          textAlign: "center",
          background: "linear-gradient(135deg, rgba(139,92,246,0.08) 0%, rgba(100,50,255,0.06) 100%)",
          borderTop: "1px solid rgba(139,92,246,0.15)",
          borderBottom: "1px solid rgba(139,92,246,0.1)",
        }}>
          <div className="landing-container">
            <h2 style={{
              fontFamily: "var(--font-heading), sans-serif",
              fontSize: "clamp(1.75rem, 4vw, 2.75rem)",
              fontWeight: 800, letterSpacing: "-0.025em",
              color: "#f0f2ff", marginBottom: "1rem",
            }}>
              Ready to build something beautiful?
            </h2>
            <p style={{ color: "rgba(240,242,255,0.55)", fontSize: "1rem", marginBottom: "2rem" }}>
              Join thousands of creators using Plexo to design faster.
            </p>
            <Link href="/auth/register" className="btn-brand" style={{ padding: "0.9rem 2.25rem", fontSize: "1rem" }}>
              Get Started for Free
              <IconArrowRight />
            </Link>
          </div>
        </section>

        {/* ── FOOTER ───────────────────────────────── */}
        <footer style={{
          padding: "3rem 1.5rem",
          borderTop: "1px solid rgba(255,255,255,0.06)",
        }}>
          <div className="landing-container" style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            flexWrap: "wrap", gap: "1.5rem",
          }}>
            <PlexoLogo />
            <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
              {(["Features", "How It Works", "Pricing"] as const).map((item) => (
                <a key={item} href={`#${item.toLowerCase().replace(/\s+/g, "-")}`} style={{
                  fontSize: "0.875rem", color: "rgba(240,242,255,0.45)",
                  textDecoration: "none", transition: "color 0.15s",
                }}>
                  {item}
                </a>
              ))}
              <Link href="/sdk" style={{ fontSize: "0.875rem", color: "rgba(240,242,255,0.45)", textDecoration: "none" }}>SDK Docs</Link>
              <Link href="/auth/login" style={{ fontSize: "0.875rem", color: "rgba(240,242,255,0.45)", textDecoration: "none" }}>Sign In</Link>
              <Link href="/auth/register" style={{ fontSize: "0.875rem", color: "rgba(240,242,255,0.45)", textDecoration: "none" }}>Register</Link>
            </div>
            <p style={{ fontSize: "0.8rem", color: "rgba(240,242,255,0.3)" }}>
              © {new Date().getFullYear()} Plexo. All rights reserved.
            </p>
          </div>
        </footer>
      </main>
    </>
  );
}
