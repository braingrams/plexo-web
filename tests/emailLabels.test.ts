import { describe, expect, it } from "vitest";
import { emailLabel, failureHelp, summarizeEmails } from "@/lib/mail/emailLabels";

describe("email log wording and stats", () => {
  it("names what an email was for", () => {
    expect(emailLabel("form_submission")).toBe("Someone filled in your form");
    expect(emailLabel("something_new")).toBe("Something new");
  });
  it("gives a plain next step for a failure", () => {
    expect(failureHelp("550 mailbox does not exist")).toMatch(/address/);
    expect(failureHelp("Request timed out")).toMatch(/hiccup/);
    expect(failureHelp(undefined)).toMatch(/try again/i);
  });
  it("counts this week's sends and failures", () => {
    const now = Date.parse("2026-11-23T12:00:00Z");
    const s = summarizeEmails([
      { status: "sent", createdAt: "2026-11-22T10:00:00Z" },
      { status: "failed", createdAt: "2026-11-20T10:00:00Z" },
      { status: "sent", createdAt: "2026-10-01T10:00:00Z" },
    ], now);
    expect(s).toEqual({ total: 3, sent: 2, failed: 1, last7: 2, failed7: 1 });
  });
});
