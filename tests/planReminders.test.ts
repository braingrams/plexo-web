import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mail/maildrip", () => ({ emailShell: ({ bodyHtml }: { bodyHtml: string }) => bodyHtml, sendMaildripEmail: vi.fn() }));
vi.mock("@/lib/mail/logEmail", () => ({ logEmailDelivery: vi.fn() }));

import { currentStage, dueReminder, type ReminderUser } from "@/lib/plan/reminders";
import { buildPaymentDeclinedEmail, buildPlanEndingSoonEmail, buildPlanRenewalSoonEmail } from "@/lib/mail/templates";

const END = "2026-11-14T15:00:00.000Z";
const at = (iso: string) => new Date(iso);
const trial = (extra: Partial<ReminderUser> = {}): ReminderUser => ({
  email: "a@b.co", subscriptionPlan: "PRO", planAccessUntil: END, planAccessSource: "TRIAL", ...extra,
});

describe("which stage an end date is in", () => {
  it("is none until a week out, then week, day, today", () => {
    expect(currentStage(END, at("2026-11-07T14:00:00Z"))).toBeNull(); // 7d 1h left
    expect(currentStage(END, at("2026-11-07T15:00:00Z"))).toBe("WEEK");
    expect(currentStage(END, at("2026-11-12T00:00:00Z"))).toBe("WEEK");
    expect(currentStage(END, at("2026-11-13T15:00:00Z"))).toBe("DAY");
    expect(currentStage(END, at("2026-11-14T02:00:00Z"))).toBe("DAY"); // 13h left: not yet the last 12h
    expect(currentStage(END, at("2026-11-14T03:00:00Z"))).toBe("TODAY");
    expect(currentStage(END, at("2026-11-14T14:59:00Z"))).toBe("TODAY");
    expect(currentStage(END, at("2026-11-14T15:00:00Z"))).toBeNull(); // ended — the "plan ended" email takes over
  });

  it("never calls the day-before and day-of reminders back to back (late-evening expiry)", () => {
    const late = "2026-11-14T23:00:00.000Z";
    expect(currentStage(late, at("2026-11-13T23:00:00Z"))).toBe("DAY");
    expect(currentStage(late, at("2026-11-14T00:00:00Z"))).toBe("DAY"); // not "today" an hour later
    expect(currentStage(late, at("2026-11-14T11:00:00Z"))).toBe("TODAY");
  });
});

describe("who is reminded", () => {
  const now = at("2026-11-10T09:00:00Z"); // 4 days out → week stage
  it("free-trial users", () => expect(dueReminder(trial(), now)).toMatchObject({ stage: "WEEK", kind: "TRIAL", endsAt: END }));
  it("admin grants with an end date", () => expect(dueReminder(trial({ planAccessSource: "ADMIN" }), now)).toMatchObject({ kind: "GRANT" }));

  it("subscribers who cancelled (a plan that ends)", () => {
    const sub: ReminderUser = { email: "a@b.co", subscriptionPlan: "ULTRA", stripeSubscriptionId: "sub_1", subscriptionStatus: "ACTIVE", subscriptionPeriodEnd: END, subscriptionCancelAtPeriodEnd: true };
    expect(dueReminder(sub, now)).toMatchObject({ stage: "WEEK", kind: "CANCELLING", endsAt: END });
    expect(dueReminder({ ...sub, subscriptionCancelAtPeriodEnd: false, planAccessUntil: null }, at("2026-11-02T00:00:00Z"))).toBeNull(); // renewal is 12 days off
  });

  it("subscribers who are renewing get ONE heads-up a week before the charge — never the countdown", () => {
    const sub: ReminderUser = { email: "a@b.co", subscriptionPlan: "PRO", stripeSubscriptionId: "sub_1", subscriptionStatus: "ACTIVE", subscriptionPeriodEnd: END, subscriptionCancelAtPeriodEnd: false };
    expect(dueReminder(sub, at("2026-11-07T14:00:00Z"))).toBeNull(); // 7d 1h out
    expect(dueReminder(sub, at("2026-11-07T15:00:00Z"))).toMatchObject({ stage: "WEEK", kind: "RENEWING", endsAt: END });
    const told = { ...sub, planExpiryReminderKey: `${END}#WEEK` };
    for (const iso of ["2026-11-10T00:00:00Z", "2026-11-13T16:00:00Z", "2026-11-14T08:00:00Z"]) expect(dueReminder(told, at(iso))).toBeNull();
    // Next month the new period end starts a fresh reminder.
    expect(dueReminder({ ...told, subscriptionPeriodEnd: "2026-12-14T15:00:00.000Z" }, at("2026-12-08T00:00:00Z"))).toMatchObject({ kind: "RENEWING" });
    expect(dueReminder({ ...sub, subscriptionStatus: "PAST_DUE" }, now)).toBeNull(); // a failing card gets the declined email instead
  });

  it("nobody who has no end date, is on Free, is kept by an admin, or has already ended", () => {
    expect(dueReminder({ email: "a@b.co", subscriptionPlan: "FREE" }, now)).toBeNull();
    expect(dueReminder(trial({ planKeptByAdmin: true }), now)).toBeNull();
    expect(dueReminder(trial(), at("2026-11-15T00:00:00Z"))).toBeNull();
    expect(dueReminder(trial({ planAccessUntil: "2027-01-01T00:00:00.000Z" }), now)).toBeNull(); // far off
  });
});

describe("sending each stage once", () => {
  it("steps week → day → today, never repeating or going backwards", () => {
    let u = trial();
    const step = (iso: string) => {
      const d = dueReminder(u, at(iso));
      if (d) u = { ...u, planExpiryReminderKey: d.key };
      return d?.stage ?? null;
    };
    expect(step("2026-11-08T00:00:00Z")).toBe("WEEK");
    expect(step("2026-11-09T00:00:00Z")).toBeNull(); // already told
    expect(step("2026-11-13T16:00:00Z")).toBe("DAY");
    expect(step("2026-11-13T20:00:00Z")).toBeNull();
    expect(step("2026-11-14T08:00:00Z")).toBe("TODAY");
    expect(step("2026-11-14T09:00:00Z")).toBeNull();
  });

  it("an account first seen late gets ONE email — the most urgent — not a catch-up burst", () => {
    expect(dueReminder(trial(), at("2026-11-13T20:00:00Z"))?.stage).toBe("DAY");
  });

  it("a changed end date (trial extended, a later cancellation) starts the reminders afresh", () => {
    const u = trial({ planExpiryReminderKey: `${END}#TODAY` });
    expect(dueReminder(u, at("2026-11-14T08:00:00Z"))).toBeNull();
    expect(dueReminder({ ...u, planAccessUntil: "2026-11-21T15:00:00.000Z" }, at("2026-11-15T08:00:00Z"))?.stage).toBe("WEEK");
  });

  it("the old single 3-day reminder counts as the week one, so nobody is told twice at the changeover", () => {
    expect(dueReminder(trial({ planAccessReminderSentAt: END }), at("2026-11-12T00:00:00Z"))).toBeNull();
    expect(dueReminder(trial({ planAccessReminderSentAt: END }), at("2026-11-13T16:00:00Z"))?.stage).toBe("DAY");
  });
});

describe("the renewal and declined-payment emails", () => {
  it("renewal: the date, the amount, what to do, and what happens if a payment fails", () => {
    const e = buildPlanRenewalSoonEmail({ plan: "PRO", renewsAt: END, amountMinor: 1900, currency: "usd", manageUrl: "https://plexo.test/m" });
    expect(e.subject).toBe("Your Pro plan renews on November 14 — Plexo");
    expect(e.html).toContain("$19.00");
    expect(e.html).toContain("https://plexo.test/m");
    expect(e.html).toContain("moves to Free");
    expect(buildPlanRenewalSoonEmail({ plan: "PRO", renewsAt: END, manageUrl: "x" }).html).not.toContain("we'll charge"); // amount unknown → left out
  });

  it("declined: says it plainly, what still works, what goes offline if unfixed, and how to fix it", () => {
    const e = buildPaymentDeclinedEmail({ plan: "PRO", amountMinor: 4900, currency: "usd", retryAt: "2026-11-17T09:00:00.000Z", manageUrl: "https://plexo.test/m" });
    expect(e.subject).toBe("Your payment didn't go through — update your card to keep Pro");
    expect(e.html).toContain("$49.00");
    expect(e.html).toContain("still fully active");
    expect(e.html).toContain("November 17");
    expect(e.html).toContain("partially inactive");
    expect(e.html).toContain("Update my card");
  });
});

describe("the email", () => {
  const base = { plan: "PRO", endsAt: END, upgradeUrl: "https://plexo.test/up" } as const;
  it("says exactly when, in plain words, with a way to keep the plan", () => {
    const week = buildPlanEndingSoonEmail({ ...base, kind: "TRIAL", stage: "WEEK" });
    expect(week.subject).toBe("Your Pro trial ends in 7 days — Plexo");
    expect(week.html).toContain("November 14");
    expect(week.html).toContain("https://plexo.test/up");
    expect(buildPlanEndingSoonEmail({ ...base, kind: "TRIAL", stage: "DAY" }).subject).toContain("ends in 1 day");
    expect(buildPlanEndingSoonEmail({ ...base, kind: "TRIAL", stage: "TODAY" }).subject).toContain("ends today");
    const cancelling = buildPlanEndingSoonEmail({ ...base, kind: "CANCELLING", stage: "WEEK" });
    expect(cancelling.subject).toBe("Your Pro plan ends in 7 days — Plexo");
    expect(cancelling.html).toContain("You've chosen to cancel");
  });
});
