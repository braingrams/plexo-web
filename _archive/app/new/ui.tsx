import type { ReactNode } from "react";

/** Small uppercase eyebrow label used above every section heading on this page. */
export function Kicker({ children, tone = "brand" }: { children: ReactNode; tone?: "brand" | "light" }) {
  return (
    <p
      className={`mb-3 text-xs font-bold tracking-[0.14em] uppercase ${
        tone === "brand" ? "text-brand-500 dark:text-brand-400" : "text-white/60"
      }`}
    >
      {children}
    </p>
  );
}

/** Browser/app window chrome — the same "traffic lights" frame used elsewhere on the
 * marketing site (see HeroSection in landing-page-client.tsx), pulled out here so the
 * hero, AI-publish card, and dark SDK section can all reuse one visual language. */
export function MockFrame({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] shadow-[var(--shadow-card)] backdrop-blur-xl ${className}`}>
      <div className="flex items-center justify-between border-b border-[var(--surface-border)] px-4 py-3">
        <div className="flex items-center gap-1.5">
          {["#f87171", "#fbbf24", "#34d399"].map((c) => (
            <span key={c} className="h-2.5 w-2.5 rounded-full opacity-70" style={{ background: c }} />
          ))}
        </div>
        <span className="font-mono text-[0.7rem] text-[var(--text-faint)]">{title}</span>
        <span className="w-10" />
      </div>
      {children}
    </div>
  );
}

/**
 * Bento card chrome (rounded/bordered surface + hover lift). Deliberately has no grid-span
 * classes of its own — in a bento grid, put col/row span on the surrounding `<Reveal>`
 * instead, since `Reveal` needs a real box to animate opacity/transform on. A `<Reveal
 * className="contents">` wrapper would break both grid placement and the fade-in, because a
 * `display:contents` element renders no box at all.
 */
export function BentoCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`group relative h-full overflow-hidden rounded-[28px] border border-[var(--surface-border)] bg-[var(--surface)] shadow-[var(--shadow-card)] transition-transform duration-300 ease-[var(--ease-out)] hover:-translate-y-1 ${className}`}
    >
      {children}
    </div>
  );
}
