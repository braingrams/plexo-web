import { describe, expect, it } from "vitest";
import { passwordProblem } from "@/lib/passwordPolicy";
import { allChecksMet, emailProblem, passwordChecks } from "@/app/auth/_kit/passwordRules";
import { formatCountdown, secondsLeft } from "@/app/auth/_kit/countdown";

describe("password checklist", () => {
  it("ticks each rule as it is met", () => {
    expect(passwordChecks("").every((c) => !c.met)).toBe(true);
    const met = (pw: string) => Object.fromEntries(passwordChecks(pw).map((c) => [c.id, c.met]));
    expect(met("abc")).toEqual({ length: false, lower: true, upper: false, number: false });
    expect(met("Abcdefghi1")).toEqual({ length: true, lower: true, upper: true, number: true });
  });

  it("agrees with the server-side password policy", () => {
    for (const pw of ["", "short1A", "alllowercase1", "ALLUPPERCASE1", "NoNumbersHere", "GoodPassw0rd", "Another-Good-1"]) {
      expect(allChecksMet(pw)).toBe(passwordProblem(pw) === null);
    }
  });
});

describe("emailProblem", () => {
  it("accepts normal addresses and explains bad ones in plain words", () => {
    expect(emailProblem("you@example.com")).toBeNull();
    expect(emailProblem("  you@example.co.uk ")).toBeNull();
    expect(emailProblem("")).toMatch(/Enter your email/);
    expect(emailProblem("you@example")).toMatch(/doesn’t look like an email/);
    expect(emailProblem("you example.com")).not.toBeNull();
  });
});

describe("resend countdown", () => {
  it("counts down by whole seconds and never goes below zero", () => {
    expect(secondsLeft(60, 0)).toBe(60);
    expect(secondsLeft(60, 1)).toBe(60);
    expect(secondsLeft(60, 1001)).toBe(59);
    expect(secondsLeft(60, 59_999)).toBe(1);
    expect(secondsLeft(60, 60_000)).toBe(0);
    expect(secondsLeft(60, 999_999)).toBe(0);
  });
  it("formats as m:ss", () => {
    expect(formatCountdown(60)).toBe("1:00");
    expect(formatCountdown(45)).toBe("0:45");
    expect(formatCountdown(5)).toBe("0:05");
    expect(formatCountdown(-3)).toBe("0:00");
  });
});
