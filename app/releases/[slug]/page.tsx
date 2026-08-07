import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2 } from "lucide-react";

import { LandingNav } from "../../landing-nav";
import { RELEASES, getRelease } from "../data";
import { Snapshot } from "../mockups";

export function generateStaticParams() {
  return RELEASES.map((release) => ({ slug: release.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const release = getRelease(slug);
  if (!release) return {};

  return {
    title: `${release.title} — Plexo Releases`,
    description: release.summary,
    alternates: { canonical: `/releases/${release.slug}` },
  };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export default async function ReleaseDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const release = getRelease(slug);
  if (!release) notFound();

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-main)] selection:bg-[var(--brand)] selection:text-white transition-colors duration-300">
      <LandingNav />

      <section className="relative pt-24 pb-8 px-5 sm:px-6 overflow-hidden border-b border-[var(--surface-border)]">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-5xl h-[280px] bg-gradient-to-b from-[var(--brand-glow)] via-transparent to-transparent blur-3xl pointer-events-none -z-10" />

        <div className="max-w-5xl mx-auto">
          <Link
            href="/releases"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--brand)] transition-colors mb-6"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> All releases
          </Link>

          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--brand)]">
            {formatDate(release.date)} &middot; {release.tagline}
          </p>
          <h1 className="mt-2 text-2xl sm:text-3xl font-extrabold tracking-tight leading-snug">
            {release.title}
          </h1>
          <p className="mt-3 text-sm text-[var(--text-muted)] leading-relaxed max-w-xl">
            {release.summary}
          </p>
        </div>
      </section>

      <main className="max-w-5xl mx-auto px-5 sm:px-6 py-10 space-y-12">
        {release.sections.map((section) => (
          <section key={section.heading} className="space-y-4">
            <h2 className="text-lg sm:text-xl font-bold tracking-tight">{section.heading}</h2>
            {section.body.map((p, i) => (
              <p key={i} className="text-sm text-[var(--text-muted)] leading-relaxed">
                {p}
              </p>
            ))}
            {section.snapshots && section.snapshots.length > 0 && (
              <div className="pt-1">
                <Snapshot rows={section.snapshots} />
              </div>
            )}
          </section>
        ))}

        {release.fixes && release.fixes.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-lg sm:text-xl font-bold tracking-tight">Fixes</h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {release.fixes.map((fix) => (
                <li key={fix} className="flex items-start gap-2 text-sm text-[var(--text-muted)]">
                  <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-500" />
                  <span>{fix}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="pt-6 border-t border-[var(--surface-border)]">
          <Link
            href="/releases"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand)] hover:opacity-80 transition-opacity"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to all releases
          </Link>
        </div>
      </main>
    </div>
  );
}
