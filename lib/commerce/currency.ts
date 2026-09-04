// Curated currency support for Commerce's site-wide `CommerceSettings.currency` — NOT an
// exhaustive ISO 4217 list. Two constraints kept this deliberately small for v1:
//
// 1. Every existing money-formatting call site in this codebase (webhooks, emails,
//    several dashboard clients, public/commerce.js) does a bare `/100` — correct only for
//    2-decimal currencies. Zero-decimal (JPY, KRW) and 3-decimal (KWD) currencies would
//    silently misformat everywhere until each of those call sites gets its own per-currency
//    decimal-places table — out of scope this pass, so those currencies are simply not
//    offered yet.
// 2. Paystack's own currency support is per-merchant-account and unverifiable from here —
//    there's no API that tells us whether a given site's connected Paystack account is
//    actually provisioned for, say, USD. PAYSTACK_SUPPORTED_CURRENCIES is the currencies
//    Paystack plausibly supports for SOME merchants; choosing one of these while on a
//    Paystack-based payment provider is not guaranteed to work, only plausible — the
//    settings route (app/api/v1/commerce/[templateId]/settings/route.ts) turns a mismatch
//    into a warning, not a hard block, since the real backstop is Paystack's own API
//    rejecting the charge at checkout time.
export const SUPPORTED_STORE_CURRENCIES: { code: string; label: string; symbol: string }[] = [
  { code: "NGN", label: "Nigerian Naira", symbol: "₦" },
  { code: "USD", label: "US Dollar", symbol: "$" },
  { code: "GBP", label: "British Pound", symbol: "£" },
  { code: "EUR", label: "Euro", symbol: "€" },
  { code: "GHS", label: "Ghanaian Cedi", symbol: "₵" },
  { code: "KES", label: "Kenyan Shilling", symbol: "KSh" },
  { code: "ZAR", label: "South African Rand", symbol: "R" },
];

export const PAYSTACK_SUPPORTED_CURRENCIES = ["NGN", "GHS", "ZAR", "KES", "USD"] as const;

const SUPPORTED_CODES = new Set(SUPPORTED_STORE_CURRENCIES.map((c) => c.code));

export function isKnownCurrency(code: string): boolean {
  return SUPPORTED_CODES.has(code.toUpperCase());
}

export function isPaystackCompatibleCurrency(code: string): boolean {
  return (PAYSTACK_SUPPORTED_CURRENCIES as readonly string[]).includes(code.toUpperCase());
}
