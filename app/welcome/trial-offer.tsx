"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { mulish } from "@/lib/mulish";
import { Check, Globe, Layers, LayoutTemplate, MessageSquare, ShoppingBag, Rocket, CreditCard } from "lucide-react";
import { PlexoLogo } from "@/app/plexo-logo";
import { planMonthlyCredits } from "@/lib/credits/value";

type TrialPlan = "PRO" | "ULTRA";

const PLANS: Record<TrialPlan, { name: string; price: string; tagline: string; perks: { icon: typeof Globe; text: string }[] }> = {
  PRO: {
    name: "Pro",
    price: "$19/mo after",
    tagline: "For your own brand, on your own domain.",
    perks: [
      { icon: Globe, text: "Your own domain (yourname.com)" },
      { icon: Rocket, text: "All your sites live at once" },
      { icon: LayoutTemplate, text: "No “Hosted with Plexo” bar" },
      { icon: MessageSquare, text: `${planMonthlyCredits("PRO").toLocaleString("en-US")} AI credits a month` },
    ],
  },
  ULTRA: {
    name: "Ultra",
    price: "$49/mo after",
    tagline: "Everything Plexo can do, with room to grow.",
    perks: [
      { icon: Layers, text: "Sites with as many pages as you like" },
      { icon: ShoppingBag, text: "A funnel included, plus everything in Pro" },
      { icon: Globe, text: "Your own domain, every site live" },
      { icon: MessageSquare, text: `${planMonthlyCredits("ULTRA").toLocaleString("en-US")} AI credits a month` },
    ],
  },
};

export function TrialOffer({ firstName, highlighted, trialDays }: { firstName: string | null; highlighted: TrialPlan; trialDays: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<TrialPlan | "free" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(choice: TrialPlan | "free"): Promise<void> {
    setBusy(choice);
    setError(null);
    try {
      const res = await fetch("/api/billing/trial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(choice === "free" ? { dismiss: true } : { plan: choice }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
      router.push(choice === "free" ? "/dashboard" : "/dashboard?trial=started");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setBusy(null);
    }
  }

  return (
    <main className={`${mulish.className} min-h-screen bg-[#0b0f19] text-white`}>
      <div className="mx-auto flex min-h-screen max-w-[1240px] flex-col px-4 py-8 sm:px-8 lg:px-12">
        <PlexoLogo size={30} textStyle={{ color: "#ffffff" }} />

        <div className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14">
          {/* The promise, and what happens on day 15 — said plainly up front. */}
          <section className="space-y-8">
            <div className="space-y-4">
              <p className="text-sm font-bold text-purple-300">{firstName ? `Welcome, ${firstName}` : "Welcome to Plexo"}</p>
              <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl">
                Try everything, free for {trialDays} days.
              </h1>
              <p className="max-w-md text-base font-medium leading-relaxed text-slate-400">
                Build with every feature switched on. No card needed — you only pay if you decide to keep it.
              </p>
            </div>

            <ol className="relative space-y-5 border-l border-slate-800 pl-6">
              <TimelineStep day="Today" title="Everything unlocked" text="Your own domain, every page live, more AI." />
              <TimelineStep day={`Day ${trialDays - 3}`} title="A friendly reminder" text="We'll email you before the trial ends." />
              <TimelineStep
                day={`Day ${trialDays}`}
                title="You choose"
                text="Keep your plan, or carry on free: one site stays live with its homepage. Nothing you built is deleted."
              />
            </ol>

            <p className="flex items-center gap-2 text-xs font-semibold text-slate-500">
              <CreditCard className="h-4 w-4" aria-hidden /> No card, no automatic charge.
            </p>
          </section>

          {/* The two plans, side by side. */}
          <section className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {(["PRO", "ULTRA"] as const).map((key) => {
                const plan = PLANS[key];
                const isHighlighted = key === highlighted;
                return (
                  <div
                    key={key}
                    className={`flex flex-col rounded-[28px] border p-6 transition-colors ${
                      isHighlighted ? "border-purple-500 bg-[#16122c] shadow-xl shadow-purple-900/30" : "border-slate-800 bg-[#0f1422] hover:border-slate-700"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <h2 className="text-2xl font-extrabold">{plan.name}</h2>
                      <span className="text-xs font-bold text-slate-400">{plan.price}</span>
                    </div>
                    <p className="mt-1 text-sm font-medium text-slate-400">{plan.tagline}</p>
                    <ul className="mt-6 flex-1 space-y-3.5">
                      {plan.perks.map(({ icon: Icon, text }) => (
                        <li key={text} className="flex items-start gap-3 text-sm font-semibold text-slate-200">
                          <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${isHighlighted ? "bg-purple-600 text-white" : "bg-slate-800 text-purple-300"}`}>
                            <Icon className="h-3.5 w-3.5" aria-hidden />
                          </span>
                          {text}
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void choose(key)}
                      className={`mt-7 w-full rounded-2xl py-3.5 text-sm font-extrabold transition-all disabled:opacity-60 ${
                        isHighlighted ? `bg-[color:var(--brand)] text-white shadow-md shadow-purple-600/30 hover:bg-[color:var(--brand-deep)]` : "border border-slate-700 bg-slate-800 text-white hover:bg-slate-700"
                      }`}
                    >
                      {busy === key ? "Starting your trial…" : `Try ${plan.name} free`}
                    </button>
                  </div>
                );
              })}
            </div>

            {error ? (
              <p role="alert" className="rounded-2xl border border-red-800 bg-red-950/70 px-4 py-3 text-sm font-semibold text-red-300">
                {error}
              </p>
            ) : null}

            <div className="flex flex-col items-start justify-between gap-3 rounded-2xl border border-slate-800/70 px-5 py-4 sm:flex-row sm:items-center">
              <div className="flex items-center gap-3 text-sm font-medium text-slate-400">
                <Check className="h-4 w-4 text-slate-500" aria-hidden />
                Free forever: one site live with its homepage, on a Plexo address.
              </div>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void choose("free")}
                className="shrink-0 text-sm font-bold text-slate-300 underline-offset-4 hover:text-white hover:underline disabled:opacity-60"
              >
                {busy === "free" ? "One moment…" : "Continue on Free"}
              </button>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function TimelineStep({ day, title, text }: { day: string; title: string; text: string }) {
  return (
    <li className="relative">
      <span className="absolute -left-[31px] top-1 h-2.5 w-2.5 rounded-full bg-purple-400 ring-4 ring-[#0b0f19]" aria-hidden />
      <p className="text-[11px] font-extrabold uppercase tracking-wider text-purple-300">{day}</p>
      <p className="mt-0.5 text-sm font-bold text-white">{title}</p>
      <p className="mt-0.5 max-w-sm text-sm font-medium leading-relaxed text-slate-400">{text}</p>
    </li>
  );
}
