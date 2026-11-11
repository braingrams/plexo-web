import { describe, expect, it } from "vitest";

import PrivacyPolicyRedirect from "@/app/legal/privacy/page";
import TermsRedirect from "@/app/legal/terms/page";
import CookiesRedirect from "@/app/legal/cookies/page";

// next/navigation's redirect() throws an error whose digest carries the destination.
function destination(page: () => never): string {
  try {
    page();
  } catch (err) {
    return String((err as { digest?: string }).digest ?? "");
  }
  return "";
}

describe("legal pages live on the public website", () => {
  it("the old in-app addresses redirect to plexopages.com", () => {
    expect(destination(PrivacyPolicyRedirect)).toContain("https://www.plexopages.com/privacy");
    expect(destination(TermsRedirect)).toContain("https://www.plexopages.com/terms");
    expect(destination(CookiesRedirect)).toContain("https://www.plexopages.com/cookies");
  });
});
