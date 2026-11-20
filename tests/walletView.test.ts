import { describe, expect, it } from "vitest";
import { checkWithdrawal, moneyState, withdrawalWords } from "@/lib/commerce/walletView";

const ok = { amount: "5,000", bankName: " GTBank ", accountNumber: "0123456789", accountHolderName: "Ada" };

describe("taking money out", () => {
  it("builds the request in kobo/cents and trims the bank details", () => {
    expect(checkWithdrawal(ok, 1_000_000, "NGN")).toEqual({ amountCents: 500_000, bankName: "GTBank", accountNumber: "0123456789", accountHolderName: "Ada" });
  });
  it("says what to fix in plain words", () => {
    expect(checkWithdrawal({ ...ok, amount: "" }, 1_000_000, "NGN")).toMatch(/How much/);
    expect(checkWithdrawal({ ...ok, amount: "abc" }, 1_000_000, "NGN")).toMatch(/How much/);
    expect(checkWithdrawal({ ...ok, amount: "20000" }, 1_000_000, "NGN")).toMatch(/more than you have.*10,000 NGN/);
    expect(checkWithdrawal({ ...ok, accountNumber: " " }, 1_000_000, "NGN")).toMatch(/Fill in your bank/);
  });
});

describe("the money screen", () => {
  it("picks one of three plain states", () => {
    expect(moneyState({ showWallet: true, commerceEnabled: true })).toBe("wallet");
    expect(moneyState({ showWallet: false, commerceEnabled: true })).toBe("own-keys");
    expect(moneyState({ showWallet: false, commerceEnabled: false })).toBe("off");
  });
  it("describes a request without codes", () => {
    expect(withdrawalWords("PENDING").text).toBe("Being checked");
    expect(withdrawalWords("PROCESSED").tone).toBe("success");
    expect(withdrawalWords("REJECTED").text).toBe("Not sent");
  });
});

import { moneySummary, timingWords } from "@/lib/commerce/walletView";
describe("money summary", () => {
  it("adds up what is available, being checked and sent", () => {
    const s = moneySummary(50_000, [
      { amountCents: 10_000, status: "PENDING", requestedAt: "2026-01-02" },
      { amountCents: 5_000, status: "PENDING", requestedAt: "2026-01-03" },
      { amountCents: 20_000, status: "PROCESSED", requestedAt: "2026-01-01", processedAt: "2026-01-04" },
      { amountCents: 9_000, status: "REJECTED", requestedAt: "2026-01-01" },
    ]);
    expect(s).toMatchObject({ availableCents: 50_000, pendingCents: 15_000, pendingCount: 2, sentCents: 20_000, lastSentAt: "2026-01-04", takeAllCents: 50_000 });
    expect(moneySummary(-5, []).availableCents).toBe(0);
    expect(moneySummary(0, []).lastSentAt).toBeNull();
  });
  it("explains timing without codes", () => {
    expect(timingWords("PENDING")).toMatch(/few business days/);
    expect(timingWords("REJECTED")).toMatch(/back in your balance/);
    expect(timingWords("PROCESSED")).toMatch(/sent to your bank/);
  });
});
