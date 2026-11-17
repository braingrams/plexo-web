// THE price list model. Every price Plexo shows or charges — plan prices in every currency,
// monthly and yearly, AI credit top-ups — comes from one PRICE BOOK: a list of country groups
// ("Nigeria", "Rest of Africa", "Rest of world", …), each with its currency, payment provider
// and prices. Any single country can be pulled out of its group with its own settings.
//
// The price book is edited in plexo-admin (Pricing page) and stored in DynamoDB
// (PriceBook entity, lib/db/coreEntities.ts); lib/billing/priceBook.ts loads it with a short
// cache. DEFAULT_PRICE_BOOK below is the seed — and the fallback if the stored one is missing
// or unreadable, so checkout never breaks for lack of a price.
//
// Prices are set by value for each market, not converted at today's exchange rate.
// Checkout makes the matching Stripe price / Paystack plan on demand from these amounts
// (lib/billing/stripePrices.ts, lib/billing/paystackBilling.ts) — a price edit needs no deploy
// and no manual setup in Stripe or Paystack. People who already subscribe move to a new price at
// their next renewal on/after the effective date the admin picks (lib/billing/priceChanges.ts).
//
// Pure and dependency-free (safe in client components, the SOL Lambda, scripts, tests and
// plexo-admin, which keeps a copy of this file — keep them identical).

import type { PaidPlanId, PlanId } from "@/lib/plan/plans";

export type BillingInterval = "monthly" | "yearly";
export type BillingProvider = "STRIPE" | "PAYSTACK";
export const BILLING_CURRENCIES = ["USD", "NGN", "GHS", "KES", "ZAR"] as const;
export type BillingCurrency = (typeof BILLING_CURRENCIES)[number];
const PAID: PaidPlanId[] = ["STARTER", "PRO", "ENTERPRISE"];

/** Which currencies each provider can charge in for Plexo. */
export const PROVIDER_CURRENCIES: Record<BillingProvider, BillingCurrency[]> = {
  STRIPE: ["USD", "ZAR", "KES", "NGN"],
  PAYSTACK: ["NGN", "GHS", "KES", "ZAR", "USD"],
};

/** One price list: a country group, or a single country with its own settings. */
export type PriceGroup = {
  /** "NG", "AFRICA", "WORLD"… — or "country:ZA" for a country with its own settings. */
  id: string;
  name: string;
  currency: BillingCurrency;
  provider: BillingProvider;
  /** Price per paid plan for one month / one year, in WHOLE currency units. Enterprise is a "from" price. */
  monthly: Record<PaidPlanId, number>;
  /**
   * Yearly price per plan, whole units — OPTIONAL and independent of monthly. A plan with no
   * entry (absent, null or 0) is monthly-only: no yearly option anywhere, and nothing yearly is
   * ever created at Stripe or Paystack for it.
   */
  yearly: Partial<Record<PaidPlanId, number | null>>;
  /** What 1,000 AI credits cost as a top-up, in whole currency units. */
  topupPer1000Credits: number;
  /** ISO 3166-1 alpha-2 countries in this group. The catch-all group (WORLD) lists none. */
  countries: string[];
};

/** Kept for readability at call sites: the price list a person is on. */
export type PriceRegion = PriceGroup;

export type PriceBook = {
  version: number;
  /** The group anyone not matched by a country gets. */
  defaultGroupId: string;
  groups: PriceGroup[];
  updatedAt?: string;
  updatedBy?: string;
};

export const COUNTRY_GROUP_PREFIX = "country:";
export const isCountryGroup = (g: Pick<PriceGroup, "id">): boolean => g.id.startsWith(COUNTRY_GROUP_PREFIX);

/** Every African country — the default "Rest of Africa" group is these minus the ones with their own group. */
export const AFRICAN_COUNTRIES = [
  "DZ", "AO", "BJ", "BW", "BF", "BI", "CV", "CM", "CF", "TD", "KM", "CG", "CD", "CI", "DJ", "EG", "GQ", "ER", "SZ", "ET",
  "GA", "GM", "GH", "GN", "GW", "KE", "LS", "LR", "LY", "MG", "MW", "ML", "MR", "MU", "MA", "MZ", "NA", "NE", "NG", "RW",
  "ST", "SN", "SC", "SL", "SO", "ZA", "SS", "SD", "TZ", "TG", "TN", "UG", "ZM", "ZW", "EH", "RE", "YT", "SH",
];

/** Seed only: the default price book starts yearly at 10 months of the monthly price. Nothing enforces it. */
export const YEARLY_MONTHS_CHARGED = 10;
const yearlyOf = (m: Record<PaidPlanId, number>): Record<PaidPlanId, number> => ({
  STARTER: m.STARTER * YEARLY_MONTHS_CHARGED,
  PRO: m.PRO * YEARLY_MONTHS_CHARGED,
  ENTERPRISE: m.ENTERPRISE * YEARLY_MONTHS_CHARGED,
});
function group(id: string, name: string, currency: BillingCurrency, provider: BillingProvider, monthly: Record<PaidPlanId, number>, topupPer1000Credits: number, countries: string[]): PriceGroup {
  return { id, name, currency, provider, monthly, yearly: yearlyOf(monthly), topupPer1000Credits, countries };
}

/**
 * The seed price book. GHS/KES/ZAR amounts are starting points the owner adjusts in admin —
 * and a Paystack account only settles the currencies of the countries it's registered in, so
 * check those before relying on them (switch a group to Stripe/USD in admin if needed).
 */
export const DEFAULT_PRICE_BOOK: PriceBook = {
  version: 0,
  defaultGroupId: "WORLD",
  groups: [
    group("NG", "Nigeria", "NGN", "PAYSTACK", { STARTER: 3_000, PRO: 7_500, ENTERPRISE: 39_000 }, 1_500, ["NG"]),
    group("GH", "Ghana", "GHS", "PAYSTACK", { STARTER: 35, PRO: 85, ENTERPRISE: 429 }, 15, ["GH"]),
    group("KE", "Kenya", "KES", "PAYSTACK", { STARTER: 450, PRO: 990, ENTERPRISE: 4_990 }, 130, ["KE"]),
    group("ZA", "South Africa", "ZAR", "PAYSTACK", { STARTER: 69, PRO: 149, ENTERPRISE: 749 }, 18, ["ZA"]),
    group("AFRICA", "Rest of Africa", "USD", "STRIPE", { STARTER: 5, PRO: 12, ENTERPRISE: 59 }, 1, AFRICAN_COUNTRIES.filter((c) => !["NG", "GH", "KE", "ZA"].includes(c))),
    group("WORLD", "Rest of world", "USD", "STRIPE", { STARTER: 9, PRO: 19, ENTERPRISE: 99 }, 1, []),
  ],
};

// ── Validation (admin saves, and loading from the database) ───────────────────────────

export function validatePriceBook(book: PriceBook): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const countryOwner = new Map<string, string>();
  if (!book.groups?.length) errors.push("The price book needs at least one group.");
  for (const g of book.groups ?? []) {
    const label = g.name || g.id;
    if (!g.id || !/^[A-Za-z0-9:_-]{1,40}$/.test(g.id)) errors.push(`"${label}" needs a short id (letters, numbers, - or _).`);
    if (ids.has(g.id)) errors.push(`Two groups share the id "${g.id}".`);
    ids.add(g.id);
    if (!g.name?.trim()) errors.push(`Group "${g.id}" needs a name.`);
    if (!(BILLING_CURRENCIES as readonly string[]).includes(g.currency)) errors.push(`"${label}": ${g.currency} isn't a supported currency.`);
    else if (!PROVIDER_CURRENCIES[g.provider]?.includes(g.currency)) errors.push(`"${label}": ${g.provider === "STRIPE" ? "Stripe" : "Paystack"} can't charge in ${g.currency}.`);
    for (const p of PAID) {
      for (const interval of ["monthly", "yearly"] as const) {
        const v = g[interval]?.[p];
        // Yearly is optional (no entry = monthly only); when it's set it just has to be a real price.
        if (interval === "yearly" && (v === undefined || v === null)) continue;
        if (!(typeof v === "number" && Number.isFinite(v) && v > 0)) errors.push(`"${label}": the ${p.toLowerCase()} ${interval} price must be more than zero${interval === "yearly" ? " (or choose no yearly option)" : ""}.`);
      }
    }
    if (!(typeof g.topupPer1000Credits === "number" && g.topupPer1000Credits > 0)) errors.push(`"${label}": the AI top-up price must be more than zero.`);
    for (const c of g.countries ?? []) {
      if (!/^[A-Z]{2}$/.test(c)) errors.push(`"${label}": "${c}" isn't a two-letter country code.`);
      if (isCountryGroup(g)) continue;
      const other = countryOwner.get(c);
      if (other) errors.push(`${c} is in both "${other}" and "${g.name}".`);
      countryOwner.set(c, g.name);
    }
    if (isCountryGroup(g) && (g.countries.length !== 1 || g.countries[0] !== g.id.slice(COUNTRY_GROUP_PREFIX.length))) {
      errors.push(`"${label}" is a single-country setting and must list just that country.`);
    }
  }
  if (book.groups?.length && !ids.has(book.defaultGroupId)) errors.push("Choose which group everyone else (rest of world) gets.");
  return errors;
}

// ── Resolution ─────────────────────────────────────────────────────────────────────────

export function normalizeCountry(country: string | null | undefined): string | null {
  const c = (country ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) && c !== "XX" && c !== "T1" ? c : null;
}

/** The group a country belongs to: its own settings, else its group, else the default. */
export function groupForCountry(book: PriceBook, country: string | null | undefined): PriceGroup {
  const c = normalizeCountry(country);
  const fallback = book.groups.find((g) => g.id === book.defaultGroupId) ?? book.groups[0];
  if (!c) return fallback;
  return book.groups.find((g) => g.id === `${COUNTRY_GROUP_PREFIX}${c}`) ?? book.groups.find((g) => !isCountryGroup(g) && g.countries.includes(c)) ?? fallback;
}

/** The USD alternative for someone whose own group charges in another currency. */
export function usdAlternative(book: PriceBook, country: string | null | undefined): PriceGroup | null {
  const own = groupForCountry(book, country);
  if (own.currency === "USD") return null;
  const c = normalizeCountry(country);
  const african = c ? AFRICAN_COUNTRIES.includes(c) : false;
  const usd = book.groups.filter((g) => g.currency === "USD" && !isCountryGroup(g) && g.provider === "STRIPE");
  // An African country falls back to the African USD prices if there are any, else the default.
  return (african ? usd.find((g) => g.countries.some((x) => AFRICAN_COUNTRIES.includes(x))) : null) ?? usd.find((g) => g.id === book.defaultGroupId) ?? usd[0] ?? null;
}

export type RegionInput = {
  /** The country the owner chose themselves — wins over everything else. */
  userCountry?: string | null;
  /** Country guessed from the request (CloudFront-Viewer-Country) — only a fallback for people who haven't chosen one. */
  headerCountry?: string | null;
  /** Saved on the account at first checkout; used when no country was chosen, and kept for a running subscription. */
  billingCountry?: string | null;
  /** "USD" also records "pay in USD instead". */
  billingCurrency?: string | null;
};

/** The country that decides prices: chosen by the owner → saved at first checkout → guessed from the request. */
export function effectiveCountry(input: RegionInput): string | null {
  return normalizeCountry(input.userCountry) ?? normalizeCountry(input.billingCountry) ?? normalizeCountry(input.headerCountry);
}

/** Which price list a person sees and pays. */
export function resolvePriceRegion(book: PriceBook, input: RegionInput): PriceGroup {
  const country = effectiveCountry(input);
  const own = groupForCountry(book, country);
  if ((input.billingCurrency ?? "").toUpperCase() === "USD" && own.currency !== "USD") return usdAlternative(book, country) ?? own;
  return own;
}

/** The two choices offered by the currency switch, when there are two. */
export function currencyChoices(book: PriceBook, input: RegionInput): { local: PriceGroup; usd: PriceGroup } | null {
  const country = effectiveCountry(input);
  const local = groupForCountry(book, country);
  const usd = usdAlternative(book, country);
  return usd ? { local, usd } : null;
}

export function regionById(book: PriceBook, id: string | null | undefined): PriceGroup | null {
  return (id && book.groups.find((g) => g.id === id)) || null;
}

export function regionForCurrency(book: PriceBook, currency: string | null | undefined): PriceGroup | null {
  const cur = (currency ?? "").toUpperCase();
  return book.groups.find((g) => g.currency === cur && !isCountryGroup(g)) ?? book.groups.find((g) => g.currency === cur) ?? null;
}

// ── Prices ─────────────────────────────────────────────────────────────────────────────

/** Minor units per whole unit — all supported currencies use 100. */
export function minorUnits(_currency: BillingCurrency | string): number {
  return 100;
}

/** Whether a plan can be bought yearly in this price list. */
export function yearlyOffered(region: Pick<PriceGroup, "yearly">, plan: PlanId): boolean {
  if (plan === "FREE") return false;
  const v = region.yearly?.[plan];
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/** Whether any plan in this price list can be bought yearly (decides if a monthly/yearly switch is shown at all). */
export function anyYearlyOffered(region: Pick<PriceGroup, "yearly">): boolean {
  return PAID.some((p) => yearlyOffered(region, p));
}

/** Price of a plan for one billing period, in whole units. Free is 0; null when that period isn't offered (yearly on a monthly-only plan). */
export function planPrice(region: Pick<PriceGroup, "monthly" | "yearly">, plan: PlanId, interval: BillingInterval): number | null {
  if (plan === "FREE") return 0;
  if (interval === "yearly") return yearlyOffered(region, plan) ? (region.yearly[plan] as number) : null;
  return region.monthly[plan];
}

/** Charge amount in minor units. Throws for a period that isn't offered, so nothing yearly is ever created for a monthly-only plan. */
export function planPriceMinor(region: Pick<PriceGroup, "monthly" | "yearly" | "currency">, plan: PlanId, interval: BillingInterval): number {
  const price = planPrice(region, plan, interval);
  if (price === null) throw new Error(`The ${plan.toLowerCase()} plan isn't offered ${interval}.`);
  return Math.round(price * minorUnits(region.currency));
}

/** "$9", "₦3,000", "GH₵35", "R69", "KSh 450". Whole amounts drop the decimals. */
export function formatMoney(amount: number, currency: BillingCurrency | string): string {
  const cur = currency.toUpperCase();
  const whole = Number.isInteger(amount);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: cur,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${cur} ${amount.toLocaleString("en-US")}`;
  }
}

export function formatMinor(amountMinor: number, currency: BillingCurrency | string): string {
  return formatMoney(amountMinor / 100, currency);
}

export type PlanPriceView = {
  plan: PaidPlanId;
  currency: BillingCurrency;
  monthly: number;
  /** null = this plan has no yearly option. */
  yearly: number | null;
  monthlyLabel: string;
  yearlyLabel: string | null;
  /** What yearly works out to per month. */
  yearlyPerMonthLabel: string | null;
  /** Information only: how much cheaper yearly is than 12 months at the monthly price, as a whole percent (0 when it isn't cheaper). */
  yearlySavingPercent: number;
  /** Whole months saved by paying yearly (2 = "2 months free"), 0 when there's no saving. */
  yearlyMonthsFree: number;
  /** Enterprise prices are a starting point. */
  isFromPrice: boolean;
};

export function planPriceView(region: PriceGroup, plan: PaidPlanId): PlanPriceView {
  const monthly = region.monthly[plan];
  const yearly = planPrice(region, plan, "yearly");
  const perMonth = yearly === null ? 0 : Math.round((yearly / 12) * 100) / 100;
  return {
    plan,
    currency: region.currency,
    monthly,
    yearly,
    monthlyLabel: formatMoney(monthly, region.currency),
    yearlyLabel: yearly === null ? null : formatMoney(yearly, region.currency),
    yearlyPerMonthLabel: yearly === null ? null : formatMoney(perMonth, region.currency),
    yearlySavingPercent: yearly !== null && monthly > 0 ? Math.max(0, Math.round((1 - yearly / (monthly * 12)) * 100)) : 0,
    yearlyMonthsFree: yearly !== null && monthly > 0 ? Math.max(0, Math.round(12 - yearly / monthly)) : 0,
    isFromPrice: plan === "ENTERPRISE",
  };
}

/** Everything a pricing screen needs for one person, serialisable to the client. */
export type PricingView = {
  regionId: string;
  regionName: string;
  currency: BillingCurrency;
  provider: BillingProvider;
  plans: Record<PaidPlanId, PlanPriceView>;
  topup: { per1000: number; per1000Label: string; packs: TopupPackView[] };
  /** Whether a monthly/yearly switch should be shown at all (some plan has a yearly price). */
  yearlyAvailable: boolean;
  /** Offered when a local currency is available: switch between it and USD. */
  currencyChoice: { localCurrency: BillingCurrency; payingInUsd: boolean } | null;
  /** The country these prices are for (null when nothing is known yet). */
  country: string | null;
  /** True once the account's currency is fixed by a running subscription (the switch is hidden). */
  locked: boolean;
};

export function pricingView(region: PriceGroup, opts: { choices?: { local: PriceGroup; usd: PriceGroup } | null; locked?: boolean; country?: string | null } = {}): PricingView {
  return {
    country: opts.country ?? null,
    regionId: region.id,
    regionName: region.name,
    currency: region.currency,
    provider: region.provider,
    plans: { STARTER: planPriceView(region, "STARTER"), PRO: planPriceView(region, "PRO"), ENTERPRISE: planPriceView(region, "ENTERPRISE") },
    yearlyAvailable: anyYearlyOffered(region),
    topup: { per1000: region.topupPer1000Credits, per1000Label: formatMoney(region.topupPer1000Credits, region.currency), packs: topupPacksFor(region) },
    currencyChoice: opts.choices && !opts.locked ? { localCurrency: opts.choices.local.currency, payingInUsd: region.id === opts.choices.usd.id } : null,
    locked: !!opts.locked,
  };
}

// ── AI credit top-ups ──────────────────────────────────────────────────────────────────
// A top-up is credits at the group's flat rate ($1 per 1,000 credits; ₦1,500 in Nigeria).
// Packs are convenient sizes; their price is credits × rate, charged with an inline price.

export const TOPUP_PACK_CREDITS = { SMALL: 5_000, MEDIUM: 20_000, LARGE: 50_000 } as const;
export type TopupPackId = keyof typeof TOPUP_PACK_CREDITS;
export const TOPUP_PACK_IDS = Object.keys(TOPUP_PACK_CREDITS) as TopupPackId[];

export type TopupPackView = { pack: TopupPackId; credits: number; amount: number; amountMinor: number; currency: BillingCurrency; price: string };

export function topupPrice(region: Pick<PriceGroup, "topupPer1000Credits">, credits: number): number {
  return Math.round((credits / 1000) * region.topupPer1000Credits * 100) / 100;
}

export function topupPack(region: PriceGroup, pack: TopupPackId): TopupPackView {
  const credits = TOPUP_PACK_CREDITS[pack];
  const amount = topupPrice(region, credits);
  return { pack, credits, amount, amountMinor: Math.round(amount * 100), currency: region.currency, price: formatMoney(amount, region.currency) };
}

export function topupPacksFor(region: PriceGroup): TopupPackView[] {
  return TOPUP_PACK_IDS.map((p) => topupPack(region, p));
}

/** Credits for a completed top-up from what was actually paid (before tax), at the given rate. */
export function creditsForTopupAmount(amountPaid: number, currency: string, region: Pick<PriceGroup, "currency" | "topupPer1000Credits">): number | null {
  if (currency.toUpperCase() !== region.currency || !(amountPaid > 0)) return null;
  return Math.max(0, Math.round((amountPaid / region.topupPer1000Credits) * 1000));
}

// ── Provider object names (made on demand at checkout) ─────────────────────────────────

/** Stripe lookup key for one plan price — the amount is in it, so a price edit makes a new price and old subscribers keep theirs. */
export function stripeLookupKey(plan: PaidPlanId, interval: BillingInterval, currency: string, amountMinor: number): string {
  return `plexo_v2_${plan.toLowerCase()}_${interval}_${currency.toLowerCase()}_${amountMinor}`;
}

/** Stripe product id per plan (custom ids, so they're found again without storing anything). */
export function stripeProductId(plan: PaidPlanId): string {
  return `plexo_plan_${plan.toLowerCase()}`;
}

/** Paystack plan name for one plan/interval/amount — likewise, a price change makes a new plan. */
export function paystackPlanName(region: Pick<PriceGroup, "currency" | "monthly" | "yearly">, plan: PaidPlanId, interval: BillingInterval): string {
  return `Plexo ${plan.charAt(0)}${plan.slice(1).toLowerCase()} ${interval} ${region.currency} ${planPrice(region, plan, interval)}`;
}
