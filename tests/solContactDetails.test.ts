import { describe, expect, it } from "vitest";
import { finishDesign, gaveContactDetails } from "@/lib/onboarding/solPersonalize";
import { computeTasks, EMPTY_FACTS } from "@/lib/dashboardV3/tasks";

describe("SOL asked for contact details and got them", () => {
  it("counts a phone number, an email or an address given to a SOL question", () => {
    expect(gaveContactDetails([{ question: "What's the best phone or WhatsApp number for people to reach you?", answer: "+234 802 345 6789" }])).toBe(true);
    expect(gaveContactDetails([{ question: "Which area of Lagos is your gym in?", answer: "Ikeja, Lagos" }])).toBe(true);
    expect(gaveContactDetails([{ question: "How can people reach you?", answer: "hello@aria.ng" }])).toBe(true);
    expect(gaveContactDetails([{ question: "Something unrelated", answer: "0803 555 0166" }])).toBe(true); // it looks like a phone number
  });

  it("does not count skipped answers or questions about something else", () => {
    expect(gaveContactDetails([{ question: "What's your phone number?", answer: "I'll add it later" }])).toBe(false);
    expect(gaveContactDetails([{ question: "Which services do you offer?", answer: "Personal training, group classes" }])).toBe(false);
    expect(gaveContactDetails([{ question: "What's your phone number?", answer: "   " }])).toBe(false);
    expect(gaveContactDetails([])).toBe(false);
    expect(gaveContactDetails(undefined)).toBe(false);
  });

  const input = { html: "<html><head></head><body><h1>x</h1></body></html>", replacements: {}, name: "Aria", domain: "fitness", design: { name: "Iron" } };
  it("stamps the page, so the checklist can tell", () => {
    expect(finishDesign({ ...input, contactProvided: true })).toContain('data-sol-personalized="true" data-sol-contact="true"');
    const without = finishDesign(input);
    expect(without).toContain('data-sol-personalized="true"');
    expect(without).not.toContain("data-sol-contact");
  });

  it("the checklist then marks 'Add your contact details' done instead of asking again", () => {
    const ask = computeTasks("business", { ...EMPTY_FACTS, hasSite: true, personalizedWithSol: true });
    expect(ask.tasks.find((t) => t.id === "contact")!.state).not.toBe("done");
    const done = computeTasks("business", { ...EMPTY_FACTS, hasSite: true, personalizedWithSol: true, contactProvided: true });
    const contact = done.tasks.find((t) => t.id === "contact")!;
    expect(contact.state).toBe("done");
    expect(contact.description).toMatch(/SOL added/);
    expect(done.currentId).not.toBe("contact");
  });
});
