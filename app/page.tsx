import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { LandingNav } from "./landing-nav";
import { PlexoLogo } from "./plexo-logo";
import { ScrollFxProvider, Reveal } from "./scroll-fx";
import {
  HeroSection,
  LogosBar,
  EcosystemSection,
  AiModesSection,
  CodePlayground,
  PricingSection,
  FaqSection,
} from "./landing-page-client";

export default function HomePage() {
  return (
    <>
      <LandingNav />

      <ScrollFxProvider>
        <main>
          <HeroSection />
          <LogosBar />
          <EcosystemSection />
          <AiModesSection />
          <CodePlayground />
          <PricingSection />
          <FaqSection />

          {/* ── FINAL CTA ───────────────────────────── */}
          <section className="landing-section" style={{ textAlign: "center" }}>
            <Reveal className="landing-container" style={{ maxWidth: 640 }}>
              <h2 className="gradient-text" style={{
                fontFamily: "var(--font-heading), sans-serif",
                fontSize: "clamp(2rem, 4.5vw, 3rem)", fontWeight: 800,
                letterSpacing: "-0.03em", marginBottom: "1.25rem",
              }}>
                Start building with Plexo today
              </h2>
              <p style={{ fontSize: "1rem", color: "var(--text-muted)", marginBottom: "2.25rem" }}>
                Free to start, no credit card required.
              </p>
              <Link href="/auth/register?plan=FREE" className="btn-brand" style={{ padding: "0.9rem 2.25rem", fontSize: "0.95rem" }}>
                Start Building Free
                <ArrowRight size={16} />
              </Link>
            </Reveal>
          </section>
        </main>
      </ScrollFxProvider>

      {/* ── FOOTER ──────────────────────────────── */}
      <footer style={{ padding: "3rem 1.5rem", borderTop: "1px solid var(--surface-border)" }}>
        <div className="landing-container" style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexWrap: "wrap", gap: "1.5rem",
        }}>
          <PlexoLogo size={26} />
          <div style={{ display: "flex", gap: "1.75rem", flexWrap: "wrap" }}>
            <a href="#features" style={{ fontSize: "0.875rem", color: "var(--text-muted)", textDecoration: "none" }}>Features</a>
            <Link href="/sdk" style={{ fontSize: "0.875rem", color: "var(--text-muted)", textDecoration: "none" }}>SDK</Link>
            <Link href="/mcp" style={{ fontSize: "0.875rem", color: "var(--text-muted)", textDecoration: "none" }}>MCP</Link>
            <a href="#pricing" style={{ fontSize: "0.875rem", color: "var(--text-muted)", textDecoration: "none" }}>Pricing</a>
            <Link href="/auth/login" style={{ fontSize: "0.875rem", color: "var(--text-muted)", textDecoration: "none" }}>Sign In</Link>
          </div>
          <span style={{ fontSize: "0.8rem", color: "var(--text-faint)" }}>
            © {new Date().getFullYear()} Plexo. All rights reserved.
          </span>
        </div>
      </footer>
    </>
  );
}
