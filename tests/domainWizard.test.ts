import { describe, expect, it } from "vitest";
import {
  alreadyCreated, certUi, certificateRecordName, customDomainProblem, isApexDomain, needsSetup,
  normalizeDomainInput, pointRecordName, resumeStep, stepPosition, stepsFor, wwwVersionOf,
} from "@/lib/domains/wizard";

describe("what people type in the domain box", () => {
  it("strips https://, login, paths, query, port, spaces and capitals", () => {
    expect(normalizeDomainInput("  HTTPS://User@WWW.Example.com:8080/path?x=1#y ")).toBe("www.example.com");
    expect(normalizeDomainInput("www.my business.com")).toBe("www.mybusiness.com");
  });
  it("keeps a trailing dot while typing and drops it when moving on", () => {
    expect(normalizeDomainInput("www.")).toBe("www.");
    expect(normalizeDomainInput("www.example.com.", { final: true })).toBe("www.example.com");
  });
});

describe("domain problems", () => {
  it("accepts real domains", () => {
    for (const d of ["www.theechoesofexperience.com", "example.com.ng", "shop.example.co.uk", "my-site.io", "xn--bcher-kva.de"]) expect(customDomainProblem(d)).toBeNull();
  });
  it("explains what is wrong in plain words", () => {
    expect(customDomainProblem("")).toMatch(/Enter the domain/);
    expect(customDomainProblem("mybusiness")).toMatch(/ending/);
    expect(customDomainProblem("my_site.com")).toMatch(/letters, numbers, hyphens/);
    expect(customDomainProblem("www..example.com")).toMatch(/extra dot/);
    expect(customDomainProblem("-a.example.com")).toMatch(/hyphen/);
    expect(customDomainProblem("example.c")).toMatch(/ending/);
    expect(customDomainProblem("example.123")).toMatch(/ending/);
  });
});

describe("root domains and record names", () => {
  it("spots a root domain, including two-part endings", () => {
    expect(isApexDomain("example.com")).toBe(true);
    expect(isApexDomain("example.com.ng")).toBe(true);
    expect(isApexDomain("www.example.com")).toBe(false);
    expect(isApexDomain("shop.example.co.uk")).toBe(false);
    expect(isApexDomain("")).toBe(false);
  });
  it("shows the name relative to the registrar's zone", () => {
    expect(pointRecordName("www.example.com")).toBe("www");
    expect(pointRecordName("example.com")).toBe("@");
    expect(pointRecordName("www.example.com.ng")).toBe("www");
    expect(pointRecordName("example.com.ng")).toBe("@");
    expect(pointRecordName("a.b.example.com")).toBe("a.b");
  });
  it("keeps .www in the certificate record name (the reported bug)", () => {
    expect(certificateRecordName("_7b3ea97fa0cc6eb5cfeaec3a780fea03.www.theechoesofexperience.com.", "www.theechoesofexperience.com")).toBe("_7b3ea97fa0cc6eb5cfeaec3a780fea03.www");
    expect(certificateRecordName("_abc.example.com.", "example.com")).toBe("_abc");
  });
  it("suggests the www version", () => {
    expect(wwwVersionOf("example.com")).toBe("www.example.com");
    expect(wwwVersionOf("www.example.com")).toBe("www.example.com");
  });
});

describe("steps", () => {
  it("numbers the steps of each way of connecting", () => {
    expect(stepsFor("CUSTOM")).toEqual(["choose", "domain", "point", "certificate"]);
    expect(stepPosition("domain", "CUSTOM")).toEqual({ n: 2, of: 4 });
    expect(stepPosition("certificate", "CUSTOM")).toEqual({ n: 4, of: 4 });
    expect(stepPosition("address", "SUBDOMAIN")).toEqual({ n: 2, of: 2 });
    expect(stepPosition("buy", "BUY")).toEqual({ n: 2, of: 2 });
    expect(stepPosition("done", "CUSTOM")).toBeNull();
  });
});

describe("certificate state", () => {
  it("reads as a person would", () => {
    expect(certUi("PENDING_VALIDATION", true)).toBe("waiting");
    expect(certUi("PENDING_VALIDATION", false)).toBe("preparing");
    expect(certUi(undefined, false)).toBe("preparing");
    expect(certUi("ISSUED", true)).toBe("issuing");
    expect(certUi("ATTACHED", true)).toBe("live");
    expect(certUi("FAILED", true)).toBe("failed");
  });
});

describe("finish setup", () => {
  it("resumes at the first thing still missing", () => {
    expect(resumeStep({ type: "CUSTOM", certificateStatus: "PENDING_VALIDATION", dnsVerified: false })).toBe("point");
    expect(resumeStep({ type: "CUSTOM", certificateStatus: "PENDING_VALIDATION", dnsVerified: true })).toBe("certificate");
    expect(resumeStep({ type: "CUSTOM", certificateStatus: "FAILED" })).toBe("certificate");
    expect(resumeStep({ type: "CUSTOM", certificateStatus: "ATTACHED" })).toBe("done");
    expect(resumeStep({ type: "SUBDOMAIN" })).toBe("done");
  });
  it("only custom domains that aren't live yet need setup", () => {
    expect(needsSetup({ type: "CUSTOM", certificateStatus: "PENDING_VALIDATION" })).toBe(true);
    expect(needsSetup({ type: "CUSTOM", certificateStatus: "FAILED" })).toBe(true);
    expect(needsSetup({ type: "CUSTOM", certificateStatus: "ATTACHED" })).toBe(false);
    expect(needsSetup({ type: "CUSTOM" })).toBe(false);
    expect(needsSetup({ type: "SUBDOMAIN", certificateStatus: "PENDING_VALIDATION" })).toBe(false);
    expect(needsSetup({ type: "CUSTOM", certificateStatus: "PENDING_VALIDATION", pausedByPlan: true })).toBe(false);
  });
  it("never creates the same domain twice", () => {
    expect(alreadyCreated({ domain: "a.com", templateId: "t" }, "a.com", "t")).toBe(true);
    expect(alreadyCreated({ domain: "a.com", templateId: "t" }, "b.com", "t")).toBe(false);
    expect(alreadyCreated(null, "a.com", "t")).toBe(false);
  });
});
