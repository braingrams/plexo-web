"use client";

import Link from "next/link";
import { useState } from "react";

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

function IconMenu() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Pricing", href: "#pricing" },
];

/**
 * The landing page's fixed navbar. Split into its own client component (rather than living
 * inline in the server-rendered page) purely so the mobile hamburger menu can hold its own
 * open/close state — the rest of the page stays a plain server component.
 */
export function LandingNav() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
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
        <Link href="/" style={{ textDecoration: "none" }} onClick={() => setMobileOpen(false)}>
          <PlexoLogo />
        </Link>

        <nav className="landing-nav-center" style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
          {NAV_LINKS.map((item) => (
            <a
              key={item.label}
              href={item.href}
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
              {item.label}
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
          <Link
            href="/mcp"
            style={{
              padding: "0.4rem 0.85rem",
              borderRadius: 8,
              fontSize: "0.875rem",
              fontWeight: 600,
              color: "#a78bfa",
              textDecoration: "none",
              transition: "color 0.15s, background 0.15s",
            }}
          >
            MCP & AI
          </Link>
        </nav>

        <div className="landing-nav-actions" style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <Link href="/auth/login" className="landing-nav-signin" style={{
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

          <button
            type="button"
            className="landing-nav-hamburger"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "#f0f2ff", padding: "0.35rem", display: "none",
              alignItems: "center", justifyContent: "center",
            }}
          >
            {mobileOpen ? <IconClose /> : <IconMenu />}
          </button>
        </div>
      </header>

      {mobileOpen && (
        <div
          className="landing-nav-mobile-panel"
          style={{
            position: "fixed",
            top: 64, left: 0, right: 0, bottom: 0,
            zIndex: 99,
            background: "rgba(8,9,15,0.98)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            padding: "1.5rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.25rem",
            overflowY: "auto",
          }}
        >
          {NAV_LINKS.map((item) => (
            <a
              key={item.label}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              style={{
                padding: "0.9rem 0.5rem",
                fontSize: "1.05rem",
                fontWeight: 600,
                color: "rgba(240,242,255,0.85)",
                textDecoration: "none",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              {item.label}
            </a>
          ))}
          <Link
            href="/sdk"
            onClick={() => setMobileOpen(false)}
            style={{
              padding: "0.9rem 0.5rem",
              fontSize: "1.05rem",
              fontWeight: 600,
              color: "rgba(240,242,255,0.85)",
              textDecoration: "none",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            SDK
          </Link>
          <Link
            href="/mcp"
            onClick={() => setMobileOpen(false)}
            style={{
              padding: "0.9rem 0.5rem",
              fontSize: "1.05rem",
              fontWeight: 600,
              color: "#a78bfa",
              textDecoration: "none",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            MCP & AI
          </Link>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "1.5rem" }}>
            <Link
              href="/auth/login"
              onClick={() => setMobileOpen(false)}
              style={{
                padding: "0.75rem 1rem", borderRadius: 9, textAlign: "center",
                fontSize: "0.95rem", fontWeight: 600,
                color: "rgba(240,242,255,0.8)", textDecoration: "none",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            >
              Sign In
            </Link>
            <Link
              href="/auth/register"
              className="btn-brand"
              onClick={() => setMobileOpen(false)}
              style={{ padding: "0.75rem 1rem", fontSize: "0.95rem", textAlign: "center" }}
            >
              Get Started
            </Link>
          </div>
        </div>
      )}

      {/*
        :global() here because these classes sit on a next/link <Link> (and the <nav>
        wrapping the Link-based SDK/MCP items) — styled-jsx only auto-scopes native DOM
        tags it can see directly in this component's JSX, not the elements a wrapped
        component like <Link> renders internally, so a scoped selector would silently
        never match them.
      */}
      <style jsx>{`
        @media (max-width: 768px) {
          :global(.landing-nav-center),
          :global(.landing-nav-signin) {
            display: none !important;
          }
          :global(.landing-nav-hamburger) {
            display: flex !important;
          }
        }
      `}</style>
    </>
  );
}
