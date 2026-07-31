"use client";

import Link from "next/link";
import { PlexoLogo } from "@/app/plexo-logo";
import { ArrowRight, BookOpen } from "lucide-react";

export function V2Footer({ isDark }: { isDark: boolean }) {
  return (
    <footer className={`pt-20 pb-12 overflow-hidden border-t transition-colors duration-500 font-['Mulish',sans-serif] ${
      isDark ? "bg-[#06080d] text-white border-slate-900" : "bg-slate-900 text-white border-slate-800"
    }`}>
      {/* Top CTA Banner */}
      <div className="max-w-7xl mx-auto px-4 sm:px-8 md:px-16 text-center border-b border-slate-800/80 pb-20">
        <h2 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-white tracking-tight mb-8">
          Get digital page &amp; email building <br className="hidden sm:inline" />
          at your fingertips
        </h2>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/auth/register"
            className="bg-[#6b3bf9] hover:bg-[#5b2be6] text-white px-8 py-4 rounded-2xl font-extrabold text-base shadow-xl hover:shadow-2xl transition-all inline-flex items-center gap-3"
          >
            <span>Start Building — It&apos;s free</span>
            <ArrowRight className="w-5 h-5" />
          </Link>

          <Link
            href="/developers"
            className="bg-slate-950 hover:bg-slate-900 border border-slate-800 text-white px-8 py-4 rounded-2xl font-bold text-base shadow-lg transition-all inline-flex items-center gap-3"
          >
            <BookOpen className="w-5 h-5 text-purple-400" />
            <span>Read Developer Docs</span>
          </Link>
        </div>
      </div>

      {/* Navigation Columns */}
      <div className="max-w-7xl mx-auto px-4 sm:px-8 md:px-16 py-16 grid grid-cols-2 md:grid-cols-4 gap-8 text-xs">
        {/* CONTACT US */}
        <div className="col-span-2 md:col-span-1 space-y-4">
          <span className="font-extrabold tracking-wider uppercase text-slate-400 block">CONTACT US</span>
          <a href="mailto:hello@plexopages.com" className="text-purple-400 hover:underline font-bold block">
            hello@plexopages.com
          </a>
        </div>

        {/* PRODUCTS */}
        <div className="space-y-3">
          <span className="font-extrabold tracking-wider uppercase text-slate-400 block">PRODUCTS</span>
          <ul className="space-y-2 text-slate-400 font-medium">
            <li><Link href="/" className="hover:text-white transition-colors">Web &amp; Email Builder</Link></li>
            <li><Link href="/sdk" className="hover:text-white transition-colors">Plexo SDK</Link></li>
            <li><Link href="/mcp" className="hover:text-white transition-colors">MCP AI Agent</Link></li>
            <li><Link href="#pricing" className="hover:text-white transition-colors">Pricing Plans</Link></li>
          </ul>
        </div>

        {/* DEVELOPERS */}
        <div className="space-y-3">
          <span className="font-extrabold tracking-wider uppercase text-slate-400 block">DEVELOPERS</span>
          <ul className="space-y-2 text-slate-400 font-medium">
            <li><Link href="/developers" className="hover:text-white transition-colors">Developer Hub</Link></li>
            <li><Link href="/developers#sdk" className="hover:text-white transition-colors">SDK Reference</Link></li>
            <li><Link href="/developers#mcp" className="hover:text-white transition-colors">MCP Setup Guide</Link></li>
            <li><Link href="/developers#api" className="hover:text-white transition-colors">API &amp; Webhooks</Link></li>
          </ul>
        </div>

        {/* RESOURCES & LEGAL */}
        <div className="space-y-3">
          <span className="font-extrabold tracking-wider uppercase text-slate-400 block">RESOURCES &amp; LEGAL</span>
          <ul className="space-y-2 text-slate-400 font-medium">
            <li><Link href="#faq" className="hover:text-white transition-colors">FAQ</Link></li>
            <li><Link href="/auth/login" className="hover:text-white transition-colors">Sign In</Link></li>
            <li><Link href="/auth/register" className="hover:text-white transition-colors">Create Account</Link></li>
            <li><Link href="/testimonials/submit" className="hover:text-white transition-colors">Submit Review</Link></li>
            <li><Link href="/legal/acceptable-use" className="hover:text-white transition-colors">Acceptable Use Policy</Link></li>
          </ul>
        </div>
      </div>

      {/* Bottom Legal & Regulatory Disclaimer */}
      <div className="max-w-7xl mx-auto px-4 sm:px-8 md:px-16 pt-8 border-t border-slate-800/80 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 text-[10px] text-slate-500 font-medium leading-relaxed">
        <div className="flex items-center gap-3">
          <PlexoLogo size={28} textStyle={{ color: "#ffffff" }} />
        </div>

        <p className="max-w-3xl">
          Plexo is a modern drag-and-drop web and email builder platform equipped with an SDK, an MCP server, and AI publish capabilities. Built for speed, security, and scale — with tenant isolation to keep every workspace private. Copyright © Plexo Inc. 2026. All rights reserved.
        </p>
      </div>

      {/* Giant Static Background Watermark Text */}
      <div className="w-full overflow-hidden select-none pointer-events-none opacity-[0.06] mt-12 text-center">
        <div className="text-5xl sm:text-7xl md:text-8xl lg:text-9xl font-extrabold uppercase tracking-tighter text-white whitespace-nowrap">
          Build without limits with Plexo
        </div>
      </div>
    </footer>
  );
}
