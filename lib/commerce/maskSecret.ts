// Split out of lib/commerce/adminAuthDynamo.ts so this pure helper has NO `next/server`
// import anywhere in its own module — adminAuthDynamo.ts itself imports { NextRequest,
// NextResponse } from "next/server" for resolveCommerceAdmin (a real Next.js API-route
// helper, unrelated to this function), and esbuild bundles a whole module's imports
// regardless of which export within it is actually used. lib/mcp/commerceTools.ts (part of
// SOL's standalone Lambda bundle via lib/ai/solAgent.ts -> lib/mcp/dispatchMcpTool.ts ->
// commerceTools.ts) needs maskSecret but must never pull in next/server, which transitively
// drags in real Next.js server runtime code that requires "@opentelemetry/api" — an optional
// peer dependency Next.js handles internally, not a real dependency of this repo, so
// esbuild's standalone bundle fails to resolve it. adminAuthDynamo.ts re-exports this from
// here so every existing call site keeps working unchanged.

/** Masks a Paystack/MailDrip secret for display — same idea as ApiKey.maskedKey: never
 * return the real value once it's set, just enough to confirm something is configured. */
export function maskSecret(plain: string | null): string | null {
  if (!plain) return null;
  if (plain.length <= 8) return "••••••••";
  return `${plain.slice(0, 4)}${"•".repeat(8)}${plain.slice(-4)}`;
}
