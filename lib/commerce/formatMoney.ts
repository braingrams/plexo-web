// Shared money formatter for every dashboard/server call site — replaces the ~8 places
// that used to hardcode a "₦" + toLocaleString("en-NG", ...) call. Mirrors the money()
// helper already in public/commerce.js (that file is a plain static asset, not part of
// the Next.js build, so it keeps its own copy — port changes there by hand if this one
// changes) rather than the cruder NGN/USD-only ternary WalletClient.tsx used to have.
//
// Plain, dependency-free, synchronous TS: safe to import from both server components and
// "use client" components without any duplication.
export function formatMoney(amountMinor: number, currency: string): string {
  const code = (currency || "NGN").toUpperCase();
  const major = (amountMinor || 0) / 100;

  if (code === "NGN") {
    return (
      "₦" +
      major.toLocaleString("en-NG", {
        minimumFractionDigits: major % 1 === 0 ? 0 : 2,
        maximumFractionDigits: 2,
      })
    );
  }

  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(major);
  } catch {
    return `${code} ${major.toFixed(2)}`;
  }
}

export { SUPPORTED_STORE_CURRENCIES } from "./currency";
