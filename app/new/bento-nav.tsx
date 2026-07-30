"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Menu, X, Sun, Moon } from "lucide-react";
import { PlexoLogo } from "../plexo-logo";

const NAV_LINKS = [
  { label: "Products", href: "#products" },
  { label: "Developers", href: "#sdk" },
  { label: "Pricing", href: "/#pricing" },
  { label: "Company", href: "#footer" },
];

const MODES = [
  { value: "web", label: "Web Builder" },
  { value: "email", label: "Email Builder" },
] as const;

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className="h-9 w-9" aria-hidden />;

  const isDark = resolvedTheme === "dark";
  return (
    <button
      type="button"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--surface-border)] bg-[var(--surface)] text-[var(--text-main)] transition-transform hover:-translate-y-0.5"
    >
      {isDark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

export function BentoNav() {
  const [mode, setMode] = useState<(typeof MODES)[number]["value"]>("web");
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = isMenuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMenuOpen]);

  return (
    <>
      <div className="sticky top-0 z-[100] border-b border-[var(--surface-border)] bg-[var(--bg)]/85 backdrop-blur-xl">
        {/* Top banner: Web / Email builder toggle — cosmetic today, wire to real routes later */}
        <div className="flex items-center justify-center gap-1 border-b border-[var(--surface-border)] px-4 py-2">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              aria-pressed={mode === m.value}
              onClick={() => setMode(m.value)}
              className={`rounded-full px-3 py-1 text-[0.72rem] font-semibold transition-colors ${
                mode === m.value
                  ? "bg-brand-500/15 text-brand-600 dark:text-brand-400"
                  : "text-[var(--text-faint)] hover:text-[var(--text-muted)]"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <nav className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-4">
          <PlexoLogo size={30} />

          <div className="hidden items-center gap-8 md:flex">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} className="text-[0.88rem] font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)]">
                {link.label}
              </a>
            ))}
          </div>

          <div className="hidden items-center gap-4 md:flex">
            <ThemeToggle />
            <Link href="/auth/login" className="text-[0.88rem] font-semibold text-[var(--text-main)]">
              Log in
            </Link>
            <Link href="/auth/register" className="btn-brand" style={{ padding: "0.6rem 1.3rem", fontSize: "0.85rem" }}>
              Get started for free
            </Link>
          </div>

          <div className="flex items-center gap-2 md:hidden">
            <ThemeToggle />
            <button
              type="button"
              aria-label={isMenuOpen ? "Close menu" : "Open menu"}
              onClick={() => setIsMenuOpen((v) => !v)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] border border-[var(--surface-border)] bg-[var(--surface)] text-[var(--text-main)]"
            >
              {isMenuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </nav>
      </div>

      {isMenuOpen && (
        <div className="fixed inset-0 z-90 flex flex-col items-center gap-7 bg-[var(--bg)] pt-24">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setIsMenuOpen(false)}
              className="text-xl font-bold text-[var(--text-main)]"
            >
              {link.label}
            </a>
          ))}
          <div className="mt-4 flex w-4/5 max-w-[280px] flex-col gap-4">
            <Link href="/auth/login" onClick={() => setIsMenuOpen(false)} className="btn-ghost justify-center">
              Log in
            </Link>
            <Link href="/auth/register" onClick={() => setIsMenuOpen(false)} className="btn-brand justify-center">
              Get started for free
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
