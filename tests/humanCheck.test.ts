import { describe, expect, it } from "vitest";
import { HUMAN_CHECK_FIELD, issueHumanCheck, verifyHumanCheck } from "@/lib/forms/humanCheck";
import { isCertainSpam, isLikelySpam, promoPhrase } from "@/lib/forms/spamHeuristics";

const SITE = "11111111-1111-4111-8111-111111111111";
const now = 1_800_000_000_000;

describe("Plexo's own check on every form", () => {
  it("accepts a genuine ticket for this site that is a few seconds old", () => {
    expect(verifyHumanCheck(issueHumanCheck(SITE, now - 10_000), SITE, now)).toBe("ok");
    expect(verifyHumanCheck(issueHumanCheck(SITE, now - 3_000), SITE, now)).toBe("ok");
    expect(HUMAN_CHECK_FIELD).toBe("_plx_check");
  });
  it("turns away a missing ticket, a made-up one and one from another site", () => {
    expect(verifyHumanCheck(undefined, SITE, now)).toBe("missing");
    expect(verifyHumanCheck("", SITE, now)).toBe("missing");
    expect(verifyHumanCheck("v1.eyJ9.bad", SITE, now)).toBe("invalid");
    expect(verifyHumanCheck("garbage", SITE, now)).toBe("invalid");
    expect(verifyHumanCheck(issueHumanCheck("22222222-2222-4222-8222-222222222222", now - 10_000), SITE, now)).toBe("invalid");
  });
  it("a form sent in under three seconds is a script, and a ticket older than two hours has run out", () => {
    expect(verifyHumanCheck(issueHumanCheck(SITE, now - 1_000), SITE, now)).toBe("too-fast");
    expect(verifyHumanCheck(issueHumanCheck(SITE, now - 3 * 60 * 60 * 1000), SITE, now)).toBe("expired");
  });
  it("a changed ticket no longer matches its signature", () => {
    const t = issueHumanCheck(SITE, now - 10_000);
    const [v, body, sig] = t.split(".");
    const other = Buffer.from(JSON.stringify({ s: SITE, t: now - 60_000, n: "x" })).toString("base64url");
    expect(verifyHumanCheck(`${v}.${other}.${sig}`, SITE, now)).toBe("invalid");
    expect(verifyHumanCheck(`${v}.${body}.${sig}x`, SITE, now)).toBe("invalid");
  });
});

describe("spam that is dropped, and spam that is only held back", () => {
  it("drops what is certain: machine calls, keyboard-mash, three links, a link with a sales pitch", () => {
    expect(isCertainSpam({ BvMethod: "getdata", Bvplugname: "malcare" })).toBe(true);
    expect(isCertainSpam({ Message: "qwrtpsdfghjklmnbvcxz" })).toBe(true);
    expect(isCertainSpam({ Message: "see https://a.co https://b.co https://c.co" })).toBe(true);
    expect(isCertainSpam({ Message: "Boost your google ranking: https://seo-deals.example" })).toBe(true);
  });
  it("keeps a real customer's message, even one that mentions a link or a trade word", () => {
    expect(isCertainSpam({ Name: "Ada", Email: "ada@example.com", Message: "Hi, we ran into your site via https://charisol.io/about and want a quote." })).toBe(false);
    expect(isCertainSpam({ Name: "Kofi", Message: "Visiting Seoul in May. Do you ship there?" })).toBe(false);
    expect(isCertainSpam({ Message: "Can you do an email list sign-up on our shop?" })).toBe(false);
  });
  it("matches sales phrases as whole words only", () => {
    expect(promoPhrase("We offer seo packages")).toBe("seo");
    expect(promoPhrase("Our office is in Seoul")).toBeNull();
    expect(promoPhrase("The crypto-mining rig")).toBe("crypto");
  });
  it("something merely suspicious is held back and marked, not dropped", () => {
    const suspicious = { Message: "We do SEO for small businesses. Call us." };
    expect(isLikelySpam(suspicious)).toBe(true);
    expect(isCertainSpam(suspicious)).toBe(false);
  });
});
