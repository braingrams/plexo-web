import { SolShell } from "./_components/SolShell";

/**
 * Shared chrome for every route under /dashboard/sol (the conversation sidebar + the
 * one-shot entrance reveal) — a plain server-component pass-through into the client
 * SolShell. Auth/org resolution already happened one level up in app/dashboard/layout.tsx;
 * this doesn't re-check it. Living at the layout level (rather than something each page
 * renders itself) is what keeps SolShell mounted across /dashboard/sol/[a] <-> [b]
 * navigation — see SolShell's own comment for why that matters.
 */
export default function SolLayout({ children }: { children: React.ReactNode }) {
  return <SolShell>{children}</SolShell>;
}
