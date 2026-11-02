import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

import { LandingNav } from "../landing-nav";
import { RELEASES } from "./data";

export const metadata: Metadata = {
  title: "Releases — What's new in Plexo",
  description: "Product updates and new features shipped to Plexo, newest first.",
  alternates: { canonical: "/releases" },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export default function ReleasesIndexPage() {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-main)] selection:bg-[var(--brand)] selection:text-white transition-colors duration-300">
      <LandingNav />

      <section className="relative pt-24 pb-10 px-5 sm:px-6 overflow-hidden border-b border-[var(--surface-border)]">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-5xl h-[280px] bg-gradient-to-b from-[var(--brand-glow)] via-transparent to-transparent blur-3xl pointer-events-none -z-10" />

        <div className="max-w-2xl mx-auto flex flex-col items-center text-center">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--surface)] border border-[var(--brand-glow)] text-[11px] font-semibold text-[var(--brand)] mb-4">
            <Sparkles className="w-3 h-3" />
            <span>Plexo Releases</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight mb-3">
            What&apos;s new
          </h1>
          <p className="text-sm text-[var(--text-muted)] max-w-md leading-relaxed">
            Every feature, fix, and improvement shipped to Plexo — newest first.
          </p>
        </div>
      </section>

      <main className="max-w-2xl mx-auto px-5 sm:px-6 py-10">
        <div className="space-y-3">
          {RELEASES.map((release) => (
            <Link
              key={release.slug}
              href={`/releases/${release.slug}`}
              className="group block rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] p-5 hover:border-[var(--brand-glow)] transition-colors"
            >
              <time className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                {formatDate(release.date)}
              </time>
              <h2 className="mt-1 text-base sm:text-lg font-bold tracking-tight text-[var(--text-main)] group-hover:text-[var(--brand)] transition-colors">
                {release.title}
              </h2>
              <p className="mt-1.5 text-sm text-[var(--text-muted)] leading-relaxed">
                {release.summary}
              </p>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand)]">
                Read more <ArrowRight className="w-3 h-3" />
              </span>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
