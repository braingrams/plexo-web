import { describe, expect, it } from "vitest";
import { normalizePhone } from "@/lib/profile/phoneFormat";

describe("the phone number on the profile", () => {
  it("turns what WhatsApp sends into international form", () => {
    expect(normalizePhone("2348012345678")).toBe("+2348012345678");
    expect(normalizePhone("+234 801 234 5678")).toBe("+2348012345678");
    expect(normalizePhone("(1) 415-555-0100")).toBe("+14155550100");
  });

  it("refuses anything that can't be a real number", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("1".repeat(20))).toBeNull();
  });
});
