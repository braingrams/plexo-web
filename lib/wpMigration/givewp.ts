import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";

import { donationToken, type DetectedDonationForm } from "./htmlTransform";

// GiveWP donation forms → Plexo Donations campaigns, with Plexo's own donate form in their
// place (one-time and monthly gifts, Stripe/Paystack/bank transfer — lib/commerce/donations.ts).
// GiveWP renders two kinds of form:
//   - classic "option-based" forms (GiveWP 2.x, still common): plain HTML with the amount
//     levels, minimum and currency right in the markup;
//   - visual-builder forms (GiveWP 3+/4 campaigns): an embed that loads the form in an iframe
//     from ?givewp-route=donation-form-view — whose page carries the form's settings as JSON.
// Past donations come through the Plexo Migrator plugin; monthly donors on Stripe/Paystack
// carry over with Commerce → Donations → "Bring over existing monthly donors".

export interface GiveFormSettings {
  title: string;
  presets: { label?: string; amountMinor: number }[];
  defaultPresetIndex: number;
  allowCustomAmount: boolean;
  minAmountMinor: number;
  allowMonthly: boolean;
  currency: string | null;
  goalMinor: number | null;
}

const minor = (v: unknown) => Math.round(Number(v) * 100);

/** The settings JSON a visual-builder form's iframe page embeds (window.givewpDonationFormExports). */
export function parseGiveFormView(viewHtml: string): GiveFormSettings | null {
  const m = /window\.givewpDonationFormExports\s*=\s*(\{[\s\S]*?\})\s*;\s*(?:\n|<\/script>)/.exec(viewHtml);
  if (!m) return null;
  let exports: { form?: Record<string, unknown> };
  try {
    exports = JSON.parse(m[1]);
  } catch {
    return null;
  }
  const form = exports.form ?? {};
  let amount: Record<string, unknown> | null = null;
  let recurring = false;
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    if (o.name === "amount" && Array.isArray(o.levels)) amount = o;
    if (o.recurringEnabled === true || (Array.isArray(o.recurringBillingPeriodOptions) && o.recurringBillingPeriodOptions.length > 0)) recurring = true;
    Object.values(o).forEach(walk);
  };
  walk(form);
  if (!amount) return null;
  const a = amount as { levels: { value: number; label?: string; checked?: boolean }[]; allowCustomAmount?: boolean; customAmountMin?: number; defaultValue?: number; recurringEnabled?: boolean };
  const presets = a.levels.filter((l) => Number(l.value) > 0).map((l) => ({ ...(l.label ? { label: String(l.label) } : {}), amountMinor: minor(l.value) }));
  const checked = a.levels.findIndex((l) => l.checked);
  const byDefault = a.levels.findIndex((l) => Number(l.value) === Number(a.defaultValue));
  const goal = (form.goal ?? form.settings) as { targetAmount?: number; goalAmount?: number; type?: string } | undefined;
  return {
    title: String((form.settings as { formTitle?: string } | undefined)?.formTitle ?? form.title ?? "Donation"),
    presets,
    defaultPresetIndex: Math.max(0, checked >= 0 ? checked : byDefault),
    allowCustomAmount: a.allowCustomAmount !== false || presets.length === 0,
    minAmountMinor: Math.max(100, minor(a.customAmountMin ?? 1)),
    allowMonthly: recurring || a.recurringEnabled === true,
    currency: typeof form.currency === "string" ? form.currency.toUpperCase() : null,
    goalMinor: goal && Number(goal.targetAmount ?? goal.goalAmount) > 0 ? minor(goal.targetAmount ?? goal.goalAmount) : null,
  };
}

/** A classic option-based form, straight from its markup. */
export function parseGiveClassicForm($: CheerioAPI, wrap: cheerio.Cheerio<never>): GiveFormSettings | null {
  const form = wrap.find("form.give-form").first();
  if (form.length === 0) return null;
  const presets: { label?: string; amountMinor: number }[] = [];
  let defaultPresetIndex = 0;
  let custom = false;
  wrap.find(".give-donation-level-btn, .give-donation-levels-wrap option, .give-radio-input-level").each((_, el) => {
    const $el = $(el);
    const value = $el.attr("value") ?? "";
    if (value === "custom" || $el.attr("data-price-id") === "custom") {
      custom = true;
      return;
    }
    const amount = Number(value.replace(/[^0-9.]/g, ""));
    if (!amount) return;
    if ($el.is(".give-default-level") || $el.is("[selected]") || $el.is("[checked]")) defaultPresetIndex = presets.length;
    const label = ($el.text() || $el.parent("label").text() || "").trim();
    presets.push({ ...(label && !/^\$?[\d.,\s]+$/.test(label) ? { label } : {}), amountMinor: minor(amount) });
  });
  // A "set donation" form has one fixed amount in its amount field.
  if (presets.length === 0) {
    const fixed = Number((wrap.find("#give-amount, input.give-amount-top, input[name='give-amount']").first().attr("value") ?? "").replace(/[^0-9.]/g, ""));
    if (fixed > 0) presets.push({ amountMinor: minor(fixed) });
  }
  const hidden = (name: string) => wrap.find(`input[name="${name}"]`).first().attr("value");
  const goalText = wrap.find(".give-goal-progress [data-goal], .give-goal-progress").first().attr("data-goal");
  return {
    title: hidden("give-form-title") || wrap.find(".give-form-title").first().text().trim() || "Donation",
    presets,
    defaultPresetIndex,
    allowCustomAmount: custom || presets.length === 0 || wrap.find("#give-amount:not([readonly])").length > 0 && presets.length === 0,
    minAmountMinor: Math.max(100, minor(hidden("give-form-minimum") ?? 1)),
    // GiveWP Recurring adds a "make this monthly" choice or a period select.
    allowMonthly: wrap.find(".give-recurring-donors-choice, .give-recurring-period, [name='give-recurring-period'], [name='give-recurring-period-donors-choice']").length > 0,
    currency: (form.attr("data-currency_code") ?? "").toUpperCase() || null,
    goalMinor: goalText && Number(goalText) > 0 ? minor(goalText) : null,
  };
}

function toDetected(source: string, s: GiveFormSettings): DetectedDonationForm & { goalMinor: number | null } {
  return {
    source,
    token: donationToken(source),
    name: s.title,
    presets: s.presets,
    defaultPresetIndex: Math.min(s.defaultPresetIndex, Math.max(0, s.presets.length - 1)),
    allowCustomAmount: s.allowCustomAmount,
    minAmountMinor: s.minAmountMinor,
    allowMonthly: s.allowMonthly,
    currency: s.currency,
    buttonLabel: null,
    goalMinor: s.goalMinor,
  };
}

const VIEW_ROUTE = /givewp-route=donation-form-view/;

/**
 * Replaces every GiveWP form on a migrated page with Plexo's donate form, returning the
 * campaigns to create (each with a token the caller swaps for the real campaign id, the
 * same way htmlTransform's Paymattic forms work). `fetchView` loads a visual-builder
 * form's iframe page.
 */
export async function convertGiveForms(
  html: string,
  fetchView: (url: string) => Promise<string | null>,
): Promise<{ html: string; forms: (DetectedDonationForm & { goalMinor: number | null })[] }> {
  if (!/give-form-wrap|givewp-route=donation-form-view|givewp-donation-form/.test(html)) return { html, forms: [] };
  const $ = cheerio.load(html);
  const forms: (DetectedDonationForm & { goalMinor: number | null })[] = [];
  const marker = (token: string) => `<div class="plexo-donation" data-plexo-donation="${token}"></div>`;

  // Classic forms.
  for (const el of $(".give-form-wrap").toArray()) {
    const wrap = $(el) as unknown as cheerio.Cheerio<never>;
    const settings = parseGiveClassicForm($, wrap);
    if (!settings) continue;
    const formId = $(el).find('input[name="give-form-id"]').attr("value") ?? $(el).attr("id") ?? String(forms.length + 1);
    const detected = toDetected(`givewp:${formId}`, settings);
    $(el).replaceWith(marker(detected.token));
    forms.push(detected);
  }

  // Visual-builder forms: the embed root (it carries the iframe URL), or a bare iframe.
  const embeds = $("[data-form-view-url], [data-src*='givewp-route=donation-form-view'], iframe[src*='givewp-route=donation-form-view']").toArray();
  const seen = new Set<unknown>();
  for (const el of embeds) {
    // The outermost element of this embed (a root div and its iframe can both match).
    const root = $(el).parents("[data-form-view-url], [data-src*='givewp-route=donation-form-view']").last();
    const target = root.length ? root[0] : el;
    if (seen.has(target)) continue;
    seen.add(target);
    const url = ($(target).attr("data-form-view-url") ?? $(target).attr("data-src") ?? $(target).attr("src") ?? "").replace(/&amp;/g, "&");
    if (!VIEW_ROUTE.test(url)) continue;
    const formId = /form-id=(\d+)/.exec(url)?.[1] ?? String(forms.length + 1);
    const view = await fetchView(url).catch(() => null);
    const settings = view ? parseGiveFormView(view) : null;
    if (!settings) continue;
    const detected = toDetected(`givewp:${formId}`, settings);
    // Also drop GiveWP's wrapper block around the embed, if any.
    const block = $(target).closest(".wp-block-give-donation-form, .givewp-donation-form, .give-embed-form-wrapper");
    (block.length ? block : $(target)).replaceWith(marker(detected.token));
    forms.push(detected);
  }
  return { html: forms.length ? $.html() : html, forms };
}
