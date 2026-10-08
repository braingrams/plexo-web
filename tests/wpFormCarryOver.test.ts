import { describe, expect, it, vi } from "vitest";

const { state } = vi.hoisted(() => ({
  state: { settings: null as Record<string, unknown> | null, sent: [] as { url: string; init: RequestInit }[], patched: [] as unknown[], added: [] as unknown[] },
}));
vi.mock("@/lib/siteImport/fetchSafe", () => ({ safeFetch: vi.fn(async (url: string, init: RequestInit) => (state.sent.push({ url, init }), new Response("ok"))) }));
vi.mock("@/lib/db/opsEntities", () => ({
  FormSettings: {
    get: () => ({ go: async () => ({ data: state.settings }) }),
    patch: () => ({ set: (v: unknown) => (state.patched.push(v), { remove: () => ({ go: async () => {} }), go: async () => {} }) }),
  },
}));
vi.mock("@/lib/db/commerceEntities", () => ({ CommerceSettings: { get: () => ({ go: async () => ({ data: { maildripApiKeyEncrypted: "enc" } }) }) } }));
vi.mock("@/lib/crypto", () => ({ decryptMaildripKey: () => "site-key", tryDecrypt: (fn: () => string) => fn() }));
vi.mock("@/lib/commerce/maildripNotify", () => ({
  addContactToMaildripGroup: vi.fn(async (key: string, group: string, contact: unknown) => void state.added.push({ key, group, contact })),
}));
import { carryOverForm, type ExportedFormActions } from "@/lib/wpMigration/formCarryOver";

const base: ExportedFormActions = { plugin: "elementor", id: "b48f986", post_id: 4271, name: "Newsletter Form", actions: [], webhook: "", webhook_advanced: false, email_to: "", redirect_to: "", lists: {} };
const origin = "https://maildrip.io";

describe("what a WordPress form did after a submission, on Plexo", () => {
  it("a webhook keeps going, in the same format its receiver expects", () => {
    expect(carryOverForm({ ...base, actions: ["email", "webhook"], webhook: "https://hooks.zapier.com/hooks/catch/1/abc" }, origin)).toEqual({
      webhookUrl: "https://hooks.zapier.com/hooks/catch/1/abc",
      webhookFormat: "form",
      notes: [],
    });
    expect(carryOverForm({ ...base, actions: ["webhook"], webhook: "https://crm.example/in", webhook_advanced: true }, origin).webhookFormat).toBe("json");
  });

  it("a thank-you page on the same site stays a path (it moves with the site)", () => {
    expect(carryOverForm({ ...base, actions: ["redirect"], redirect_to: "https://maildrip.io/email-marketing-roadmap-thank-you/" }, origin).redirectUrl).toBe("/email-marketing-roadmap-thank-you/");
    expect(carryOverForm({ ...base, actions: ["redirect"], redirect_to: "https://calendly.com/maildrip" }, origin).redirectUrl).toBe("https://calendly.com/maildrip");
  });

  it("a MailDrip list carries over; another provider is explained, with what to do", () => {
    expect(carryOverForm({ ...base, actions: ["maildrip"], lists: { maildrip_group: "64f0c0ffee" } }, origin).maildripGroupId).toBe("64f0c0ffee");
    const mc = carryOverForm({ ...base, actions: ["mailchimp"], lists: { mailchimp_list: "a1b2c3" } }, origin);
    expect(mc.maildripGroupId).toBeUndefined();
    expect(mc.notes[0]).toMatch(/Mailchimp \(list a1b2c3\).*MailDrip list.*webhook/);
  });

  it("plain email and saved submissions need nothing; anything else is named", () => {
    expect(carryOverForm({ ...base, actions: ["email", "collect_submissions"] }, origin)).toEqual({ notes: [] });
    expect(carryOverForm({ ...base, actions: ["slack"] }, origin).notes[0]).toMatch(/"slack"/);
    expect(carryOverForm({ ...base, actions: ["email2"] }, origin).notes[0]).toMatch(/confirmation email/);
  });
});

describe("form submissions reach MailDrip and webhooks", () => {
  it("finds the person in a submission", async () => {
    const { contactFromFields } = await import("@/lib/forms/formActions");
    expect(contactFromFields({ Email: "Ada@Example.com", "First Name": "Ada" })).toEqual({ email: "ada@example.com", firstName: "Ada" });
    expect(contactFromFields({ "Your Name": "Ada Lovelace", "Your Email": "ada@example.com", Phone: "+234 800" })).toEqual({ email: "ada@example.com", firstName: "Ada", lastName: "Lovelace", phone: "+234 800" });
    expect(contactFromFields({ Message: "hello" })).toBeNull();
  });

  it("a migrated webhook gets the fields form-encoded under their labels, like WordPress sent them", async () => {
    state.settings = { webhookUrl: "https://hooks.zapier.com/x", webhookFormat: "form" };
    const { runFormActions } = await import("@/lib/forms/formActions");
    await runFormActions({ templateId: "site1", formName: "Newsletter Form", fields: { Email: "ada@example.com", "First Name": "Ada" }, siteHost: "maildrip.io" });
    expect(state.sent[0].url).toBe("https://hooks.zapier.com/x");
    expect((state.sent[0].init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(new URLSearchParams(String(state.sent[0].init.body)).get("First Name")).toBe("Ada");
    expect(state.patched[0]).toHaveProperty("lastDeliveredAt");
  });

  it("a MailDrip list gets the person, in the site's own MailDrip account", async () => {
    state.settings = { maildripGroupId: "grp1" };
    state.sent.length = 0;
    const { runFormActions } = await import("@/lib/forms/formActions");
    await runFormActions({ templateId: "site1", formName: "Newsletter Form", fields: { Email: "ada@example.com", "First Name": "Ada" } });
    expect(state.added).toEqual([{ key: "site-key", group: "grp1", contact: { email: "ada@example.com", firstName: "Ada" } }]);
  });

  it("obvious spam never reaches the list", async () => {
    state.settings = { maildripGroupId: "grp1" };
    state.added.length = 0;
    const { runFormActions } = await import("@/lib/forms/formActions");
    await runFormActions({ templateId: "site1", formName: "Newsletter Form", fields: { Email: "x@spam.biz", Message: "Boost your SEO ranking with backlinks http://a.b http://c.d http://e.f" } });
    expect(state.added).toEqual([]);
  });
});
