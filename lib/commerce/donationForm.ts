/** Plain-words rules for donation forms, shared by the hub's Donations screen and the old page. */
import type { DonationsOverview } from "./donations";

export type Campaign = DonationsOverview["campaigns"][number];

export interface Draft {
  id: string | null;
  name: string;
  description: string;
  presets: { label: string; amount: string }[];
  defaultPresetIndex: number;
  allowCustomAmount: boolean;
  minAmount: string;
  allowMonthly: boolean;
  defaultFrequency: "ONCE" | "MONTHLY";
  goal: string;
  thankYouMessage: string;
  emailSubject: string;
  emailBody: string;
  buttonLabel: string;
}

export const newDraft = (): Draft => ({
  id: null,
  name: "",
  description: "",
  presets: [{ label: "", amount: "25" }, { label: "", amount: "50" }, { label: "", amount: "100" }, { label: "", amount: "250" }],
  defaultPresetIndex: 2,
  allowCustomAmount: true,
  minAmount: "1",
  allowMonthly: true,
  defaultFrequency: "ONCE",
  goal: "",
  thankYouMessage: "",
  emailSubject: "",
  emailBody: "",
  buttonLabel: "",
});

export function draftFrom(c: Campaign): Draft {
  return {
    id: c.id,
    name: c.name,
    description: c.description ?? "",
    presets: c.presetAmounts.map((p) => ({ label: p.label ?? "", amount: String(p.amountMinor / 100) })),
    defaultPresetIndex: c.defaultPresetIndex,
    allowCustomAmount: c.allowCustomAmount,
    minAmount: String(c.minAmountMinor / 100),
    allowMonthly: c.allowMonthly,
    defaultFrequency: c.defaultFrequency,
    goal: c.goalAmountMinor ? String(c.goalAmountMinor / 100) : "",
    thankYouMessage: c.thankYouMessage ?? "",
    emailSubject: (c as { emailSubject?: string | null }).emailSubject ?? "",
    emailBody: (c as { emailBody?: string | null }).emailBody ?? "",
    buttonLabel: c.buttonLabel ?? "",
  };
}

const num = (v: string) => Number(v.replace(/,/g, ""));

/** The body to send, or one plain sentence saying what to fix. */
export function checkDraft(d: Draft): Record<string, unknown> | string {
  if (!d.name.trim()) return "Give your donation form a name, like “Support our work”.";
  const filled = d.presets.filter((p) => p.amount.trim());
  const presetAmounts = filled.map((p) => ({ amountMinor: Math.round(num(p.amount) * 100), ...(p.label.trim() ? { label: p.label.trim() } : {}) }));
  if (presetAmounts.some((p) => !Number.isFinite(p.amountMinor) || p.amountMinor <= 0)) return "Each suggested amount needs to be a number above zero, like 50.";
  if (!presetAmounts.length && !d.allowCustomAmount) return "Add at least one suggested amount, or let donors type their own.";
  if (d.goal.trim() && !(num(d.goal) > 0)) return "Your goal should be an amount above zero, like 5000. Leave it empty if you don't have one.";
  if (d.allowCustomAmount && d.minAmount.trim() && !(num(d.minAmount) > 0)) return "The smallest amount should be above zero, like 1.";
  return {
    name: d.name.trim(),
    description: d.description,
    presetAmounts,
    defaultPresetIndex: Math.min(d.defaultPresetIndex, Math.max(0, presetAmounts.length - 1)),
    allowCustomAmount: d.allowCustomAmount,
    minAmountMinor: Math.max(1, Math.round(num(d.minAmount || "1") * 100)),
    allowMonthly: d.allowMonthly,
    defaultFrequency: d.allowMonthly ? d.defaultFrequency : "ONCE",
    goalAmountMinor: d.goal.trim() ? Math.round(num(d.goal) * 100) : null,
    thankYouMessage: d.thankYouMessage.trim(),
    emailSubject: d.emailSubject.trim(),
    emailBody: d.emailBody.trim(),
    buttonLabel: d.buttonLabel.trim(),
  };
}

/** 0 to 100, for the progress bar; null when there is no goal. */
export function goalPercent(raisedMinor: number, goalMinor: number | null | undefined): number | null {
  if (!goalMinor || goalMinor <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((raisedMinor / goalMinor) * 100)));
}

export const embedCode = (campaignId: string) => `<div data-plexo-donation="${campaignId}"></div>`;

export function monthlyStatusWords(status: string, charges: number): string {
  if (status === "ACTIVE") return `${charges} payment${charges === 1 ? "" : "s"} so far`;
  if (status === "PAST_DUE") return "Card was declined";
  return "Stopped";
}
