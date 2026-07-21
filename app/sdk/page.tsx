import Link from "next/link";

function IconArrowLeft() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 5l-7 7 7 7"/>
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}

function IconSparkles() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275Z"/>
    </svg>
  );
}

function IconTerminal() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

function PlexoLogo() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", textDecoration: "none" }}>
      <div style={{
        width: 32, height: 32, borderRadius: 8,
        background: "linear-gradient(135deg, var(--brand), var(--brand-deep))",
        display: "grid", placeItems: "center",
        boxShadow: "0 0 16px rgba(252,6,148,0.45)",
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M12 2L4 7v5c0 4.97 3.35 9.63 8 10.93C17.65 21.63 21 16.97 21 12V7L12 2z" fill="white" opacity="0.9" />
          <path d="M9 12l2 2 4-4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <span style={{
        fontFamily: "var(--font-heading), sans-serif",
        fontWeight: 700, fontSize: "1.1rem",
        color: "#f0f2ff", letterSpacing: "-0.02em",
      }}>Plexo SDK</span>
    </div>
  );
}

export default function PublicSdkPage() {
  return (
    <>
      {/* Navbar */}
      <header style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
        padding: "0 1.5rem", height: 64,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "rgba(8,9,15,0.85)", borderBottom: "1px solid rgba(255,255,255,0.06)",
        backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <Link href="/" style={{
            display: "flex", alignItems: "center", gap: "0.35rem",
            color: "rgba(240,242,255,0.5)", textDecoration: "none", fontSize: "0.85rem", fontWeight: 600,
            padding: "0.4rem 0.75rem", borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)",
            transition: "color 0.15s, background 0.15s",
          }}>
            <IconArrowLeft />
            Back
          </Link>
          <PlexoLogo />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <Link href="/auth/login" style={{
            padding: "0.5rem 1rem", borderRadius: 9, fontSize: "0.875rem", fontWeight: 600,
            color: "rgba(240,242,255,0.8)", textDecoration: "none", border: "1px solid rgba(255,255,255,0.1)",
          }}>
            Sign In
          </Link>
          <Link href="/auth/register" className="btn-brand" style={{ padding: "0.5rem 1.1rem", fontSize: "0.875rem" }}>
            Get API Key
          </Link>
        </div>
      </header>

      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "calc(64px + 5rem) 2rem 6rem" }}>
        
        {/* Hero Section */}
        <section style={{ textAlign: "center", marginBottom: "5rem", position: "relative" }}>
          {/* Background glow */}
          <div aria-hidden style={{
            position: "absolute", top: "-30%", left: "50%", transform: "translateX(-50%)",
            width: 700, height: 350, borderRadius: "50%",
            background: "radial-gradient(circle, var(--brand-subtle) 0%, transparent 70%)",
            filter: "blur(60px)", pointerEvents: "none", zIndex: -1,
          }} />

          <span style={{
            background: "var(--brand-subtle)", border: "1px solid rgba(139,92,246,0.25)",
            borderRadius: 999, padding: "0.35rem 1rem", fontSize: "0.73rem", fontWeight: 700,
            color: "var(--brand)", textTransform: "uppercase", letterSpacing: "0.1em", display: "inline-block",
            marginBottom: "1.5rem",
          }}>
            Developer SDK Documentation
          </span>

          <h1 style={{
            fontFamily: "var(--font-heading), sans-serif",
            fontSize: "clamp(2.4rem, 5vw, 4rem)", fontWeight: 800,
            lineHeight: 1.08, letterSpacing: "-0.03em", color: "#f0f2ff",
            maxWidth: 820, margin: "0 auto 1.5rem",
          }}>
            Integrate the visual template builder into your app
          </h1>

          <p style={{
            fontSize: "1.1rem", color: "rgba(240,242,255,0.55)",
            maxWidth: 640, margin: "0 auto", lineHeight: 1.7,
          }}>
            The{" "}
            <code style={{ fontFamily: "monospace", color: "#8b5cf6", fontSize: "0.95rem" }}>@charisol/plexo-sdk</code>
            {" "}npm package lets you embed the drag-and-drop builder directly in your React pages,
            compile templates to production-ready HTML, and configure AI provider routing.
          </p>
        </section>

        {/* Installation */}
        <section style={{
          background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 16, padding: "1.75rem", marginBottom: "2.5rem",
        }}>
          <h2 style={{
            fontFamily: "var(--font-heading), sans-serif", fontSize: "1.25rem", fontWeight: 700,
            color: "#f0f2ff", marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.5rem",
          }}>
            <span style={{ color: "var(--brand)" }}><IconTerminal /></span>
            1. Installation
          </h2>
          <div style={{
            background: "rgba(0, 0, 0, 0.4)", border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 10, padding: "1rem 1.25rem", fontFamily: "monospace", fontSize: "0.9rem",
            color: "var(--brand)", overflowX: "auto",
          }}>
            <span style={{ color: "rgba(240,242,255,0.4)" }}># Install the Plexo SDK package</span><br />
            npm install @charisol/plexo-sdk
          </div>
        </section>

        {/* Integration Scenarios */}
        <section style={{ display: "grid", gap: "2rem", gridTemplateColumns: "1fr", marginBottom: "4rem" }}>
          
          {/* React Builder */}
          <div style={{
            background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 16, padding: "1.75rem",
          }}>
            <h2 style={{
              fontFamily: "var(--font-heading), sans-serif", fontSize: "1.25rem", fontWeight: 700,
              color: "#f0f2ff", marginBottom: "0.5rem",
            }}>
              2. Embed the Visual Builder
            </h2>
            <p style={{ fontSize: "0.875rem", color: "rgba(240,242,255,0.5)", marginBottom: "1.25rem", lineHeight: 1.6 }}>
              Place the{" "}
              <code style={{ fontFamily: "monospace", color: "var(--brand)", fontSize: "0.82rem" }}>{"<PlexoBuilder />"}</code>
              {" "}component inside any React component page to give your users a premium visual editing workspace. Pass an API key to load their subscription tier settings automatically.
            </p>
            <pre style={{
              background: "rgba(0, 0, 0, 0.4)", border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 10, padding: "1.25rem", fontFamily: "monospace", fontSize: "0.82rem",
              color: "rgba(240,242,255,0.85)", overflowX: "auto", lineHeight: 1.5,
            }}>
{`import React, { useRef } from 'react';
import { PlexoBuilder, type PlexoBuilderRef } from '@charisol/plexo-sdk';

export default function TemplateEditor() {
  const builderRef = useRef<PlexoBuilderRef>(null);

  const handleSave = async () => {
    if (builderRef.current) {
      // Export design as JSON and compiled responsive HTML
      const { json, html } = await builderRef.current.exportDesign('email');
      
      // Save data to your database
      await fetch('/api/save', {
        method: 'POST',
        body: JSON.stringify({ json, html }),
      });
    }
  };

  return (
    <div style={{ height: '80vh' }}>
      <PlexoBuilder
        ref={builderRef}
        apiKey="YOUR_PLEXO_API_KEY"
        mode="email" // or 'landing_page'
        themeBgColor="var(--brand)"
        textColor="#ffffff"
        useAi={true} // Enable AI copilot support
      />
      <button onClick={handleSave}>Save Canvas</button>
    </div>
  );
}`}
            </pre>
          </div>

          {/* Backend Compilation */}
          <div style={{
            background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 16, padding: "1.75rem",
          }}>
            <h2 style={{
              fontFamily: "var(--font-heading), sans-serif", fontSize: "1.25rem", fontWeight: 700,
              color: "#f0f2ff", marginBottom: "0.5rem",
            }}>
              3. Compile to HTML / Plain Text on Backend
            </h2>
            <p style={{ fontSize: "0.875rem", color: "rgba(240,242,255,0.5)", marginBottom: "1.25rem", lineHeight: 1.6 }}>
              Plexo templates can be compiled on server environments (Node.js, Next.js API, Server Actions) directly to clean HTML or plain text using lightweight compiler functions without rendering the React builder viewport.
            </p>
            <pre style={{
              background: "rgba(0, 0, 0, 0.4)", border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 10, padding: "1.25rem", fontFamily: "monospace", fontSize: "0.82rem",
              color: "rgba(240,242,255,0.85)", overflowX: "auto", lineHeight: 1.5,
            }}>
{`import { compileToHTML, compileToPlainText } from '@charisol/plexo-sdk';

// Fetch the saved JSON design configuration from your database
const templateJson = await db.templates.findUnique({ where: { id: '...' } });

// Compile to production-ready, cross-client HTML
const responsiveHtml = compileToHTML(templateJson.designJson);

// Compile to plain text backup for email clients
const plainText = compileToPlainText(templateJson.designJson);
`}
            </pre>
          </div>
        </section>

        {/* Feature List */}
        <section style={{ marginBottom: "4rem" }}>
          <h2 style={{
            fontFamily: "var(--font-heading), sans-serif", fontSize: "1.5rem", fontWeight: 800,
            color: "#f0f2ff", marginBottom: "1.5rem", textAlign: "center",
          }}>
            SDK Capabilities
          </h2>
          <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
            {[
              "Embeddable visual editor component with complete control layers",
              "Lightweight compilation of templates directly to responsive HTML",
              "Automatic injected support for Strata Design tokens",
              "AI assistant route integration with support for multiple providers",
              "Fully custom upload handlers for media uploads in the workspace",
              "Full TypeScript typing interfaces for all JSON models",
            ].map((cap, i) => (
              <div key={i} className="glass-card" style={{ padding: "1.25rem", display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
                <span style={{ color: "var(--brand)", flexShrink: 0, marginTop: 2 }}>
                  <IconCheck />
                </span>
                <span style={{ fontSize: "0.875rem", color: "rgba(240,242,255,0.7)", lineHeight: 1.5 }}>
                  {cap}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section style={{
          background: "linear-gradient(135deg, rgba(139,92,246,0.08) 0%, rgba(100,50,255,0.06) 100%)",
          border: "1px solid rgba(139,92,246,0.15)", borderRadius: 20, padding: "3rem 1.5rem",
          textAlign: "center",
        }}>
          <h2 style={{
            fontFamily: "var(--font-heading), sans-serif", fontSize: "1.8rem", fontWeight: 800,
            color: "#f0f2ff", marginBottom: "0.75rem",
          }}>
            Ready to integrate Plexo?
          </h2>
          <p style={{ color: "rgba(240,242,255,0.55)", fontSize: "0.95rem", marginBottom: "1.5rem", maxWidth: 500, margin: "0 auto 1.5rem" }}>
            Create an account to get a developer API key, setup custom AI creativity parameters, and embed the canvas.
          </p>
          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/auth/register" className="btn-brand" style={{ padding: "0.75rem 1.75rem" }}>
              Create Developer Account
            </Link>
            <Link href="/" className="btn-ghost" style={{ padding: "0.75rem 1.75rem" }}>
              Explore Platform
            </Link>
          </div>
        </section>

      </main>

      {/* ── FOOTER ─────────────────────────────── */}
      <footer style={{
        borderTop: "1px solid rgba(255,255,255,0.06)",
        padding: "2.5rem 2rem",
        marginTop: 0,
      }}>
        <div style={{
          maxWidth: 1000,
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "1.5rem",
        }}>
          {/* Logo */}
          <Link href="/" style={{ textDecoration: "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}>
              <div style={{
                width: 28, height: 28, borderRadius: 7,
                background: "linear-gradient(135deg,var(--brand),var(--brand-deep))",
                display: "grid", placeItems: "center",
                boxShadow: "0 0 12px var(--brand-glow)",
                flexShrink: 0,
              }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2L4 7v5c0 4.97 3.35 9.63 8 10.93C17.65 21.63 21 16.97 21 12V7L12 2z" fill="white" opacity="0.95" />
                  <path d="M9 12l2 2 4-4" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <span style={{
                fontFamily: "var(--font-heading), sans-serif",
                fontWeight: 700, fontSize: "0.95rem",
                color: "#f0f2ff", letterSpacing: "-0.02em",
              }}>
                Plexo SDK
              </span>
            </div>
          </Link>

          {/* Links */}
          <div style={{ display: "flex", gap: "1.75rem", flexWrap: "wrap", alignItems: "center" }}>
            {[
              { label: "Platform", href: "/" },
              { label: "Features", href: "/#features" },
              { label: "Pricing", href: "/#pricing" },
              { label: "Sign In", href: "/auth/login" },
              { label: "Register", href: "/auth/register" },
            ].map((item) => (
              <Link key={item.label} href={item.href} style={{
                fontSize: "0.82rem", color: "rgba(240,242,255,0.4)",
                textDecoration: "none", transition: "color 0.15s",
              }}>
                {item.label}
              </Link>
            ))}
          </div>

          {/* Copyright */}
          <p style={{ fontSize: "0.78rem", color: "rgba(240,242,255,0.25)" }}>
            © {new Date().getFullYear()} Plexo. All rights reserved.
          </p>
        </div>
      </footer>
    </>
  );
}
