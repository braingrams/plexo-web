import { beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_ALERT_TOPIC_IDS, cleanAdminAlertRoutes, DEFAULT_ADMIN_ALERT_EMAIL, recipientsForTopic } from "@/lib/admin/alertTopics";

const sent: string[] = [];
const state = { fail: new Set<string>(), recipients: ["a@x.co", "b@x.co"] };
vi.mock("@/lib/mail/maildrip", async (orig) => ({
  ...(await orig<typeof import("@/lib/mail/maildrip")>()),
  sendMaildripEmail: async (m: { to: string }) => { if (state.fail.has(m.to)) throw new Error("down"); sent.push(m.to); },
}));
vi.mock("@/lib/mail/logEmail", () => ({ logEmailDelivery: () => {} }));
vi.mock("@/lib/admin/alertRecipients", () => ({ adminAlertRecipients: async () => state.recipients }));

import { sendFeedbackNotificationEmail } from "@/lib/email";

describe("who gets the team emails", () => {
  const routes = cleanAdminAlertRoutes({
    u1: { email: "Ada@Plexo.com", name: "Ada", topics: ["testimonial", "feedback", "nonsense"] },
    u2: { email: "kofi@plexo.com", topics: ["withdrawal", "access"] },
    u3: { email: "not-an-email", topics: ["feedback"] },
    u4: { email: "none@plexo.com", topics: [] },
    u5: "garbage",
  });
  it("keeps only real addresses and known topics", () => {
    expect(Object.keys(routes).sort()).toEqual(["u1", "u2"]);
    expect(routes.u1).toEqual({ email: "ada@plexo.com", name: "Ada", topics: ["testimonial", "feedback"] });
    expect(cleanAdminAlertRoutes(null)).toEqual({});
    expect(cleanAdminAlertRoutes([1, 2])).toEqual({});
  });
  it("sends each topic to the admins who chose it, and combines topics per admin", () => {
    expect(recipientsForTopic("feedback", routes, "x@y.co")).toEqual(["ada@plexo.com"]);
    expect(recipientsForTopic("withdrawal", routes, "x@y.co")).toEqual(["kofi@plexo.com"]);
    expect(recipientsForTopic("testimonial", routes, "x@y.co")).toEqual(["ada@plexo.com"]);
  });
  it("falls back to the default address when nobody chose a topic, so nothing is missed", () => {
    expect(recipientsForTopic("feedback", {}, DEFAULT_ADMIN_ALERT_EMAIL)).toEqual(["moakinyemi8@gmail.com"]);
    expect(DEFAULT_ADMIN_ALERT_EMAIL).toBe("moakinyemi8@gmail.com");
  });
  it("covers testimonials, feedback, withdrawals and access requests", () => {
    expect(ADMIN_ALERT_TOPIC_IDS).toEqual(["testimonial", "feedback", "withdrawal", "access"]);
  });
});

describe("sending a team email", () => {
  const feedback = { userName: "Bo", userEmail: "bo@x.co", message: "Love it" };
  beforeEach(() => { sent.length = 0; state.fail.clear(); state.recipients = ["a@x.co", "b@x.co"]; });
  it("sends one message to each chosen admin through MailDrip", async () => {
    await sendFeedbackNotificationEmail(feedback);
    expect(sent.sort()).toEqual(["a@x.co", "b@x.co"]);
  });
  it("still reaches the others when one address fails", async () => {
    state.fail.add("a@x.co");
    await sendFeedbackNotificationEmail(feedback);
    expect(sent).toEqual(["b@x.co"]);
  });
  it("reports a failure only when nobody could be reached", async () => {
    state.fail = new Set(["a@x.co", "b@x.co"]);
    await expect(sendFeedbackNotificationEmail(feedback)).rejects.toThrow("down");
  });
});
