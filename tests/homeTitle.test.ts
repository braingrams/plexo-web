import { describe, expect, it } from "vitest";
import { callIt, homeTitle, isGenericName, thingOf } from "@/lib/dashboardV3/homeTitle";

describe("the Home title", () => {
  it("speaks to the owner while the site isn't online, so a starting name never reads oddly", () => {
    expect(homeTitle({ name: "Deployed app", kind: "App with sign-in", allDone: false })).toBe("Let's get your app online");
    expect(homeTitle({ name: "Mama Tee Kitchen", kind: "Website", allDone: false })).toBe("Let's get your site online");
  });

  it("uses the name once online, unless it is only a starting name", () => {
    expect(homeTitle({ name: "Mama Tee Kitchen", kind: "Website", allDone: true })).toBe("Mama Tee Kitchen is online");
    expect(homeTitle({ name: "Deployed app", kind: "App", allDone: true })).toBe("Your app is online");
    expect(callIt("Untitled", null)).toBe("Your site");
  });

  it("recognises starting names and apps", () => {
    for (const n of ["Deployed app", "untitled", "My site", "New app", "", "  "]) expect(isGenericName(n), n).toBe(true);
    expect(isGenericName("Deployed Apps Co")).toBe(false);
    expect(thingOf("App with sign-in")).toBe("app");
    expect(thingOf("Online store")).toBe("site");
  });
});
