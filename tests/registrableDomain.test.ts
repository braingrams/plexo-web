import { describe, expect, it } from "vitest";
import { registrableDomain, registrarRelativeName } from "@/lib/domains/registrable";

describe("registrar-relative DNS names", () => {
  it("the Echoes case: the certificate record keeps .www, the routing record is just www", () => {
    expect(registrarRelativeName("_7b3ea97fa0cc6eb5cfeaec3a780fea03.www.theechoesofexperience.com.", "www.theechoesofexperience.com")).toBe("_7b3ea97fa0cc6eb5cfeaec3a780fea03.www");
    expect(registrarRelativeName("www.theechoesofexperience.com", "www.theechoesofexperience.com")).toBe("www");
  });
  it("a root domain's certificate record has no host part", () => {
    expect(registrarRelativeName("_abc.example.com.", "example.com")).toBe("_abc");
    expect(registrarRelativeName("example.com", "example.com")).toBe("@");
  });
  it("deeper subdomains and two-part endings", () => {
    expect(registrarRelativeName("_abc.shop.example.com.", "shop.example.com")).toBe("_abc.shop");
    expect(registrableDomain("www.example.com.ng")).toBe("example.com.ng");
    expect(registrableDomain("shop.example.co.uk")).toBe("example.co.uk");
    expect(registrableDomain("example.com.ng")).toBe("example.com.ng");
    expect(registrarRelativeName("_abc.www.example.com.ng.", "www.example.com.ng")).toBe("_abc.www");
    expect(registrableDomain("a.b.example.io")).toBe("example.io");
  });
  it("odd input is shown as it is, not guessed at", () => {
    expect(registrarRelativeName("_abc.other.com.", "example.com")).toBe("_abc.other.com");
    expect(registrableDomain("localhost")).toBe("localhost");
  });
});
