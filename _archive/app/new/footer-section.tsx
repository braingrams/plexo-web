import Link from "next/link";
import { ArrowRight, Globe, MessageCircle, Rss } from "lucide-react";
import { Reveal } from "../scroll-fx";
import { PlexoLogo } from "../plexo-logo";

const COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Web builder", href: "#products" },
      { label: "Email builder", href: "#products" },
      { label: "Pricing", href: "/#pricing" },
    ],
  },
  {
    title: "Developers",
    links: [
      { label: "SDK", href: "/sdk" },
      { label: "MCP", href: "/mcp" },
      { label: "Documentation", href: "/sdk" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "#footer" },
      { label: "Blog", href: "#footer" },
      { label: "Contact", href: "mailto:hello@plexo.co" },
    ],
  },
  {
    title: "Legal & support",
    links: [
      { label: "Privacy policy", href: "/legal/acceptable-use" },
      { label: "Terms of service", href: "/legal/acceptable-use" },
      { label: "Help center", href: "mailto:hello@plexo.co" },
    ],
  },
];

export function PreFooterCta() {
  return (
    <section className="relative isolate -mt-10 overflow-hidden rounded-t-[56px] rounded-b-[56px] bg-gradient-to-br from-brand-700 via-fuchsia-600 to-brand-500 px-6 pb-24 pt-24 text-center text-white">
      <div aria-hidden className="pointer-events-none absolute -bottom-24 left-1/2 h-72 w-[560px] -translate-x-1/2 rounded-full bg-white/10 blur-3xl" />
      <Reveal className="relative mx-auto max-w-[680px]">
        <h2 className="font-heading mb-8 text-[clamp(1.6rem,3.4vw,2.5rem)] font-extrabold tracking-[-0.03em] md:whitespace-nowrap">
          Start building better templates today.
        </h2>
        <Link
          href="/auth/register?plan=FREE"
          className="mx-auto inline-flex w-fit items-center gap-2 rounded-xl bg-white px-9 py-4 text-[1.05rem] font-bold text-brand-700 transition-transform hover:-translate-y-0.5"
        >
          Get started — it&apos;s free
          <ArrowRight size={18} />
        </Link>
      </Reveal>
    </section>
  );
}

export function BentoFooter() {
  return (
    <footer id="footer" className="relative -mt-10 overflow-hidden rounded-t-[56px] bg-surface-0 px-6 pb-4 pt-20 text-white">
      <div className="mx-auto max-w-[1200px]">
        <div className="mb-14 grid grid-cols-2 gap-10 sm:grid-cols-3 md:grid-cols-5">
          <div className="col-span-2 sm:col-span-3 md:col-span-1">
            <p className="mb-3 text-xs font-bold tracking-[0.14em] text-white/40 uppercase">Contact us</p>
            <a href="mailto:hello@plexo.co" className="mb-4 block text-sm text-brand-400 hover:text-brand-300">
              hello@plexo.co
            </a>
            <div className="flex gap-2">
              {[Globe, MessageCircle, Rss].map((Icon, i) => (
                <span key={i} className="grid h-8 w-8 place-items-center rounded-lg bg-white/5 text-white/60">
                  <Icon size={14} />
                </span>
              ))}
            </div>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="mb-3 text-xs font-bold tracking-[0.14em] text-white/40 uppercase">{col.title}</p>
              <div className="flex flex-col gap-2.5">
                {col.links.map((link) => (
                  <Link key={link.label} href={link.href} className="text-sm text-white/65 hover:text-white">
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col items-center justify-between gap-3 border-t border-white/10 py-6 sm:flex-row">
          <PlexoLogo size={22} textStyle={{ color: "#fff" }} />
          <span className="text-xs text-white/40">© {new Date().getFullYear()} Plexo. All rights reserved.</span>
        </div>
      </div>

      <div aria-hidden className="pointer-events-none -mb-[3vw] flex justify-center select-none">
        <span className="text-[19vw] font-black leading-none tracking-tighter text-white/5">PLEXO</span>
      </div>
    </footer>
  );
}
