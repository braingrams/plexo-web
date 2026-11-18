import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TESTIMONIALS, Testimonials } from "@/app/auth/_kit/Testimonials";
import { MARKETING_URL } from "@/app/auth/_kit/marketing";

describe("sign-in screen testimonials", () => {
  it("has two testimonials, so the previous / next arrows show", () => {
    expect(TESTIMONIALS).toHaveLength(2);
    const html = renderToStaticMarkup(<Testimonials />);
    expect(html).toContain('aria-label="Next quote"');
    expect(html).toContain('aria-label="Previous quote"');
  });
  it("each person has a picture, and the company is spelled MeerHQ", () => {
    for (const t of TESTIMONIALS) expect(t.avatar).toMatch(/^\/brand\/testimonials\/.+\.png$/);
    const first = renderToStaticMarkup(<Testimonials items={[TESTIMONIALS[0]]} />);
    expect(first).toContain("Founder, MeerHQ");
    expect(first).not.toContain("MeetHQ");
    expect(first).toContain("/brand/testimonials/meerhq.png");
  });
  it("the second testimonial is attributed to Yeshua Helimax Foundation, CEO", () => {
    const second = renderToStaticMarkup(<Testimonials items={[TESTIMONIALS[1]]} />);
    expect(second).toContain("Yeshua Helimax Foundation");
    expect(second).toContain("CEO");
    expect(second).toContain("/brand/testimonials/yeshua-helimax.png");
  });
  it("the Plexo logo leads to the marketing website", () => {
    expect(MARKETING_URL).toBe("https://plexopages.com");
  });
});
