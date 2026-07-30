"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Menu, X, Sun, Moon } from "lucide-react";
import { PlexoLogo } from "./plexo-logo";

const NAV_LINKS = [
  { label: "Studio", href: "#studio" },
  { label: "Features", href: "#features" },
  { label: "Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
];

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // Avoids a hydration mismatch: the server has no way to know the visitor's stored
  // theme preference, so this renders nothing until mounted client-side confirms it.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="theme-toggle-btn" aria-hidden style={{ visibility: "hidden" }} />;
  }

  const isDark = resolvedTheme === "dark";
  return (
    <button
      type="button"
      className="theme-toggle-btn"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

export function LandingNav() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = isMenuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMenuOpen]);

  return (
    <>
      <nav className={`site-nav${isScrolled ? " is-scrolled" : ""}`}>
        <div
          className="landing-container"
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
        >
          <PlexoLogo size={30} />

          <div
            className="nav-center-links"
            style={{ display: "none", alignItems: "center", gap: "2rem" }}
          >
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                style={{ fontSize: "0.88rem", fontWeight: 600, color: "var(--text-muted)", textDecoration: "none" }}
              >
                {link.label}
              </a>
            ))}
            <Link href="/sdk" style={{ fontSize: "0.88rem", fontWeight: 600, color: "var(--brand)", textDecoration: "none" }}>
              SDK
            </Link>
            <Link href="/mcp" style={{ fontSize: "0.88rem", fontWeight: 600, color: "var(--brand)", textDecoration: "none" }}>
              MCP
            </Link>
          </div>

          <div
            className="nav-right-actions"
            style={{ display: "none", alignItems: "center", gap: "1rem" }}
          >
            <ThemeToggle />
            <Link href="/auth/login" style={{ fontSize: "0.88rem", fontWeight: 600, color: "var(--text-main)", textDecoration: "none" }}>
              Sign In
            </Link>
            <Link href="/auth/register" className="btn-brand" style={{ padding: "0.6rem 1.3rem", fontSize: "0.85rem" }}>
              Get Started Free
            </Link>
          </div>

          <div className="nav-mobile-actions" style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <ThemeToggle />
            <button
              type="button"
              aria-label={isMenuOpen ? "Close menu" : "Open menu"}
              onClick={() => setIsMenuOpen((v) => !v)}
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 36, height: 36, borderRadius: 10, border: "1px solid var(--surface-border)",
                background: "var(--surface)", color: "var(--text-main)", cursor: "pointer",
              }}
            >
              {isMenuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>
      </nav>

      {isMenuOpen && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 90, background: "var(--bg)",
            paddingTop: "6rem", display: "flex", flexDirection: "column",
            alignItems: "center", gap: "1.75rem",
          }}
        >
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setIsMenuOpen(false)}
              style={{ fontSize: "1.3rem", fontWeight: 700, color: "var(--text-main)", textDecoration: "none" }}
            >
              {link.label}
            </a>
          ))}
          <Link href="/sdk" onClick={() => setIsMenuOpen(false)} style={{ fontSize: "1.3rem", fontWeight: 700, color: "var(--brand)", textDecoration: "none" }}>
            SDK
          </Link>
          <Link href="/mcp" onClick={() => setIsMenuOpen(false)} style={{ fontSize: "1.3rem", fontWeight: 700, color: "var(--brand)", textDecoration: "none" }}>
            MCP
          </Link>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginTop: "1rem", width: "80%", maxWidth: 280 }}>
            <Link href="/auth/login" onClick={() => setIsMenuOpen(false)} className="btn-ghost" style={{ justifyContent: "center" }}>
              Sign In
            </Link>
            <Link href="/auth/register" onClick={() => setIsMenuOpen(false)} className="btn-brand" style={{ justifyContent: "center" }}>
              Get Started Free
            </Link>
          </div>
        </div>
      )}

      <style jsx>{`
        @media (min-width: 900px) {
          .nav-center-links {
            display: flex !important;
          }
          .nav-right-actions {
            display: flex !important;
          }
          .nav-mobile-actions {
            display: none !important;
          }
        }
      `}</style>
    </>
  );
}
