import { describe, expect, it } from "vitest";
import { fieldLabel, isTechnicalField, submitterOf, visibleFields } from "@/lib/forms/technicalFields";

describe("what a form owner sees", () => {
  it("hides verification answers, spam readings and WordPress plumbing", () => {
    for (const k of ["cf-turnstile-response", "g-recaptcha-response", "h-captcha-response", "maspik_signals", "maspik_honeypot", "_hp_field", "action", "_wpnonce", "form_id", "post_id", "queried_id", "referer_title", "_wp_http_referer"]) {
      expect(isTechnicalField(k), k).toBe(true);
    }
  });
  it("keeps every real question", () => {
    for (const k of ["Your Name", "Email", "Other needs", "How did you find us?", "Category", "Phone number", "message", "What Service Describes Your Need?"]) {
      expect(isTechnicalField(k), k).toBe(false);
    }
  });
  it("shows only what the visitor wrote, in order, without empty answers", () => {
    const shown = visibleFields({ Category: "Mobile App Development", Email: "a@b.co", "cf-turnstile-response": "1.tK3bl…", maspik_signals: '{"v":1}', "Your Name": "Uche", Empty: "  " });
    expect(shown).toEqual([["Category", "Mobile App Development"], ["Email", "a@b.co"], ["Your Name", "Uche"]]);
  });
  it("reads a field's name the way a person would", () => {
    expect(fieldLabel("form_fields[email]")).toBe("Email");
    expect(fieldLabel("your-name")).toBe("Your name");
    expect(fieldLabel("How did you find us?")).toBe("How did you find us?");
  });
  it("finds who sent it", () => {
    const f = visibleFields({ Category: "x", Email: "uche@charisol.io", "Your Name": "Uche Sylvia" });
    expect(submitterOf(f)).toEqual({ name: "Uche Sylvia", email: "uche@charisol.io" });
    expect(submitterOf(visibleFields({ message: "hi" }))).toEqual({ name: null, email: null });
  });
});
