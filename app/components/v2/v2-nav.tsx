"use client";

import Link from "next/link";
import { PlexoLogo } from "@/app/plexo-logo";
import { Sun, Moon, ArrowRight } from "lucide-react";

export function V2Nav({
  isDark,
  onToggleTheme,
}: {
  isDark: boolean;
  onToggleTheme: () => void;
}) {
  return (
    <header
      className={`w-full sticky top-0 z-50 transition-colors duration-500 backdrop-blur-md font-['Mulish',sans-serif] ${
        isDark ? "bg-[#0b0f19]/90 text-white border-b border-slate-800/80" : "bg-white/90 text-slate-900 border-b border-slate-100"
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-8 md:px-16 h-20 flex items-center justify-between">
        {/* Left Brand Logo */}
        <Link href="/" className="flex items-center gap-2 group">
          <PlexoLogo size={36} textStyle={{ color: isDark ? "#ffffff" : "#0f172a" }} />
        </Link>

        {/* Center Nav Links */}
        <nav className="hidden md:flex items-center gap-8 text-sm font-bold tracking-tight">
          <Link href="#products" className="hover:text-purple-400 transition-colors">
            Products
          </Link>
          <Link href="/developers" className="hover:text-purple-400 transition-colors">
            Developers
          </Link>
          <Link href="#pricing" className="hover:text-purple-400 transition-colors">
            Pricing
          </Link>
          <Link href="#faq" className="hover:text-purple-400 transition-colors">
            FAQ
          </Link>
        </nav>

        {/* Right CTA & Theme Toggle */}
        <div className="flex items-center gap-4">
          {/* Light/Dark Mode Switcher */}
          <button
            onClick={onToggleTheme}
            aria-label="Toggle Theme"
            className={`p-2.5 rounded-full border transition-all ${
              isDark
                ? "bg-slate-900 border-slate-800 text-yellow-400 hover:bg-slate-800"
                : "bg-slate-100 border-slate-200 text-purple-600 hover:bg-slate-200"
            }`}
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Login Link */}
          <Link
            href="/auth/login"
            className="hidden sm:inline-flex text-xs font-extrabold hover:text-purple-400 transition-colors px-2 py-1"
          >
            Sign In
          </Link>

          {/* Primary Action Button */}
          <Link
            href="/auth/register"
            className="bg-[#6b3bf9] hover:bg-[#5b2be6] text-white text-xs font-extrabold px-5 py-3 rounded-2xl shadow-lg hover:shadow-xl transition-all transform hover:-translate-y-0.5 active:translate-y-0 inline-flex items-center gap-2"
          >
            <span>Start Free</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </header>
  );
}
