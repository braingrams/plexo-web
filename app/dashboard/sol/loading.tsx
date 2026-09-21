/**
 * Overrides app/dashboard/loading.tsx's generic PageSkeleton for this entire subtree
 * (/dashboard/sol, /dashboard/sol/[id], /dashboard/sol/settings, /dashboard/sol/memory).
 * Next.js shows the nearest loading.tsx up the tree while the destination route's async
 * Server Components (auth, org resolution, DynamoDB reads) are still resolving — i.e.
 * BEFORE SolShell/SolEntranceOverlay even exist yet, so the parent dashboard's skeleton
 * was flashing first and the entrance animation only started after. Rendering nothing
 * here (just SOL's own background color, so there's no flash of a mismatched background
 * either) means that gap is just a blank dark screen instead of a competing skeleton UI —
 * the entrance overlay itself is the only "something is loading" moment SOL ever shows.
 * Any real skeleton state (the conversation list, a settings section) belongs inside those
 * components themselves, rendered once the actual SOL view has mounted, not here.
 */
export default function SolLoading() {
  return <div style={{ position: "fixed", inset: 0, background: "#060409" }} />;
}
